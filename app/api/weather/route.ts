import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';

// NWS API endpoints
// First, get the grid point from lat/lon, then get the forecast
const DEFAULT_LAT = 40.7128;
const DEFAULT_LON = -74.0060;
const MIN_LAT = -90;
const MAX_LAT = 90;
const MIN_LON = -180;
const MAX_LON = 180;
const WEATHER_REQUEST_TIMEOUT_MS = 8000;

async function getGridPoint(lat: number, lon: number): Promise<{ gridId: string; gridX: number; gridY: number }> {
  const response = await fetchWithTimeout(`https://api.weather.gov/points/${lat},${lon}`, {
    headers: {
      'User-Agent': 'subway-times-app/1.0',
    },
    next: { revalidate: 3600 }, // Cache for 1 hour
    timeoutMs: WEATHER_REQUEST_TIMEOUT_MS,
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
  const response = await fetchWithTimeout(
    `https://api.weather.gov/gridpoints/${gridId}/${gridX},${gridY}/forecast`,
    {
      headers: {
        'User-Agent': 'subway-times-app/1.0',
      },
      next: { revalidate: 1800 }, // Cache for 30 minutes
      timeoutMs: WEATHER_REQUEST_TIMEOUT_MS,
    }
  );

  if (!response.ok) {
    throw new Error(`NWS forecast API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getHourlyForecast(gridId: string, gridX: number, gridY: number) {
  const response = await fetchWithTimeout(
    `https://api.weather.gov/gridpoints/${gridId}/${gridX},${gridY}/forecast/hourly`,
    {
      headers: {
        'User-Agent': 'subway-times-app/1.0',
      },
      next: { revalidate: 900 }, // Cache for 15 minutes
      timeoutMs: WEATHER_REQUEST_TIMEOUT_MS,
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
    const latParam = searchParams.get('lat');
    const lonParam = searchParams.get('lon');
    const lat = latParam !== null ? parseFloat(latParam) : DEFAULT_LAT;
    const lon = lonParam !== null ? parseFloat(lonParam) : DEFAULT_LON;

    const latIsInvalid = Number.isNaN(lat) || !Number.isFinite(lat) || lat < MIN_LAT || lat > MAX_LAT;
    const lonIsInvalid = Number.isNaN(lon) || !Number.isFinite(lon) || lon < MIN_LON || lon > MAX_LON;

    if (latIsInvalid || lonIsInvalid) {
      return NextResponse.json(
        { error: 'Invalid latitude or longitude', message: 'Latitude must be between -90 and 90, longitude between -180 and 180.' },
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

    // Validate forecast response structure
    const periods = forecast?.properties?.periods;
    if (!Array.isArray(periods) || periods.length === 0) {
      return NextResponse.json(
        { error: 'Invalid forecast data', message: 'Weather service returned an unexpected response structure.' },
        { status: 502 }
      );
    }

    // Validate hourly forecast response structure
    const hourlyPeriods = hourlyForecast?.properties?.periods;
    if (!Array.isArray(hourlyPeriods) || hourlyPeriods.length === 0) {
      return NextResponse.json(
        { error: 'Invalid hourly forecast data', message: 'Weather service returned an unexpected response structure.' },
        { status: 502 }
      );
    }

    // Extract today's forecast
    const todayPeriod = periods[0];
    
    // Find today's high and low
    // Today's periods are typically the first 2-3 periods (day/night/day)
    let todayHigh = todayPeriod.isDaytime ? todayPeriod.temperature : null;
    let todayLow = !todayPeriod.isDaytime ? todayPeriod.temperature : null;
    
    // Look through first few periods to find today's high/low
    // Start at index 1 since periods[0] is already processed above
    for (let i = 1; i < Math.min(4, periods.length); i++) {
      const period = periods[i];
      if (period.isDaytime && (todayHigh === null || period.temperature > todayHigh)) {
        todayHigh = period.temperature;
      }
      if (!period.isDaytime && (todayLow === null || period.temperature < todayLow)) {
        todayLow = period.temperature;
      }
    }
    
    // Fallback: use hourly forecast to fill in missing high/low
    if (todayHigh === null || todayLow === null) {
      const todayHourlyTemps = hourlyPeriods.slice(0, 24).map((p: { temperature: number }) => p.temperature);
      if (todayHourlyTemps.length > 0) {
        if (todayHigh === null) todayHigh = Math.max(...todayHourlyTemps);
        if (todayLow === null) todayLow = Math.min(...todayHourlyTemps);
      }
    }

    // Get current conditions from hourly forecast
    const currentHour = hourlyPeriods[0];

    // Ensure we always return either a number or explicit null to match UI expectations
    const resolvedTodayHigh = todayHigh ?? currentHour?.temperature ?? todayPeriod.temperature ?? null;
    const resolvedTodayLow = todayLow ?? currentHour?.temperature ?? todayPeriod.temperature ?? null;

    // Extract wind information
    const windSpeed = currentHour.windSpeed || todayPeriod.windSpeed || 'N/A';
    const windDirection = currentHour.windDirection || todayPeriod.windDirection || 'N/A';

    // Get hourly forecast (next 24 hours)
    const hourlyForecastData = hourlyPeriods.slice(0, 24).map((period: {
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
        high: resolvedTodayHigh,
        low: resolvedTodayLow,
        condition: todayPeriod.shortForecast,
        windSpeed: todayPeriod.windSpeed,
        windDirection: todayPeriod.windDirection,
      },
      hourly: hourlyForecastData,
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
