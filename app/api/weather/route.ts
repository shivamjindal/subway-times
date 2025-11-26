import { NextResponse } from 'next/server';

// NWS API endpoints
// First, get the grid point from lat/lon, then get the forecast
async function getGridPoint(lat: number, lon: number): Promise<{ gridId: string; gridX: number; gridY: number }> {
  const response = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: {
      'User-Agent': 'subway-times-app/1.0',
    },
    next: { revalidate: 3600 }, // Cache for 1 hour
  });

  if (!response.ok) {
    throw new Error(`NWS points API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    gridId: data.properties.gridId,
    gridX: data.properties.gridX,
    gridY: data.properties.gridY,
  };
}

async function getForecast(gridId: string, gridX: number, gridY: number) {
  const response = await fetch(
    `https://api.weather.gov/gridpoints/${gridId}/${gridX},${gridY}/forecast`,
    {
      headers: {
        'User-Agent': 'subway-times-app/1.0',
      },
      next: { revalidate: 1800 }, // Cache for 30 minutes
    }
  );

  if (!response.ok) {
    throw new Error(`NWS forecast API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getHourlyForecast(gridId: string, gridX: number, gridY: number) {
  const response = await fetch(
    `https://api.weather.gov/gridpoints/${gridId}/${gridX},${gridY}/forecast/hourly`,
    {
      headers: {
        'User-Agent': 'subway-times-app/1.0',
      },
      next: { revalidate: 900 }, // Cache for 15 minutes
    }
  );

  if (!response.ok) {
    throw new Error(`NWS hourly forecast API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Default to NYC coordinates (Manhattan)
    const lat = parseFloat(searchParams.get('lat') || '40.7128');
    const lon = parseFloat(searchParams.get('lon') || '-74.0060');

    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json(
        { error: 'Invalid latitude or longitude' },
        { status: 400 }
      );
    }

    // Get grid point
    const gridPoint = await getGridPoint(lat, lon);

    // Get forecast and hourly forecast in parallel
    const [forecast, hourlyForecast] = await Promise.all([
      getForecast(gridPoint.gridId, gridPoint.gridX, gridPoint.gridY),
      getHourlyForecast(gridPoint.gridId, gridPoint.gridX, gridPoint.gridY),
    ]);

    // Extract today's forecast
    const periods = forecast.properties.periods;
    const todayPeriod = periods[0];
    
    // Find today's high and low
    // Today's periods are typically the first 2-3 periods (day/night/day)
    let todayHigh = todayPeriod.isDaytime ? todayPeriod.temperature : null;
    let todayLow = !todayPeriod.isDaytime ? todayPeriod.temperature : null;
    
    // Look through first few periods to find today's high/low
    for (let i = 0; i < Math.min(4, periods.length); i++) {
      const period = periods[i];
      if (period.isDaytime && (todayHigh === null || period.temperature > todayHigh)) {
        todayHigh = period.temperature;
      }
      if (!period.isDaytime && (todayLow === null || period.temperature < todayLow)) {
        todayLow = period.temperature;
      }
    }
    
    // Fallback if we didn't find both
    if (todayHigh === null) todayHigh = todayPeriod.temperature;
    if (todayLow === null) todayLow = todayPeriod.temperature;

    // Get current conditions from hourly forecast
    const currentHour = hourlyForecast.properties.periods[0];

    // Extract wind information
    const windSpeed = currentHour.windSpeed || todayPeriod.windSpeed || 'N/A';
    const windDirection = currentHour.windDirection || todayPeriod.windDirection || 'N/A';

    // Get hourly forecast (next 24 hours)
    const hourlyPeriods = hourlyForecast.properties.periods.slice(0, 24).map((period: {
      startTime: string;
      temperature: number;
      shortForecast: string;
      windSpeed: string;
      windDirection: string;
      probabilityOfPrecipitation?: { value: number };
      isDaytime: boolean;
    }) => ({
      time: period.startTime,
      temperature: period.temperature,
      condition: period.shortForecast,
      windSpeed: period.windSpeed,
      windDirection: period.windDirection,
      probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value || 0,
      isDaytime: period.isDaytime,
    }));

    return NextResponse.json({
      current: {
        temperature: currentHour.temperature || todayPeriod.temperature,
        condition: currentHour.shortForecast || todayPeriod.shortForecast,
        windSpeed,
        windDirection,
        isDaytime: currentHour.isDaytime ?? todayPeriod.isDaytime,
      },
      today: {
        high: todayHigh,
        low: todayLow,
        condition: todayPeriod.shortForecast,
        windSpeed: todayPeriod.windSpeed,
        windDirection: todayPeriod.windDirection,
      },
      hourly: hourlyPeriods,
      location: {
        gridId: gridPoint.gridId,
        gridX: gridPoint.gridX,
        gridY: gridPoint.gridY,
      },
      lastUpdated: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.error('Error fetching weather:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch weather data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
