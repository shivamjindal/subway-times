'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { formatArrivalTime, formatTime, type TrainArrival, type ServiceAlert } from '@/lib/subway-parser';
import { AlertCircle } from 'lucide-react';

interface SubwayTimesData {
  arrivals: TrainArrival[];
  alerts: ServiceAlert[];
  lastUpdated: number;
}

export function SubwayTimesDisplay() {
  const [data, setData] = useState<SubwayTimesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (showRefreshing = false) => {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await fetch('/api/subway-times');
      if (!response.ok) {
        throw new Error('Failed to fetch subway times');
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.message || 'Failed to fetch subway times');
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchData(true);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-4 max-w-2xl">
        <div className="mb-6 text-center">
          <div className="text-4xl mb-2">🦃 🍂 🥧</div>
          <h1 className="text-3xl font-bold text-primary mb-1">Happy Thanksgiving!</h1>
          <p className="text-muted-foreground">Loading train times...</p>
        </div>
        <Card className="border-2 border-primary/20">
          <CardHeader className="bg-gradient-to-r from-accent/10 to-primary/10">
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 max-w-2xl">
        <div className="mb-6 text-center">
          <div className="text-4xl mb-2">🦃 🍂 🥧</div>
          <h1 className="text-3xl font-bold text-primary mb-1">Happy Thanksgiving!</h1>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          <p>We're having trouble fetching train times, but we hope you have a great holiday!</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      {/* Thanksgiving Banner */}
      <div className="mb-6 text-center">
        <div className="text-4xl mb-2">🦃 🍂 🥧</div>
        <h1 className="text-3xl font-bold text-primary mb-1">Happy Thanksgiving!</h1>
        <p className="text-muted-foreground">Wishing you safe travels this holiday season</p>
      </div>
      
      <Card className="border-2 border-primary/20 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-accent/10 to-primary/10">
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">🍁</span>
            7th Ave (Brooklyn)
            <Badge className="bg-[#FF6319] text-white hover:bg-[#FF6319]/90">
              F
            </Badge>
            <Badge className="bg-[#6CBE45] text-white hover:bg-[#6CBE45]/90">
              G
            </Badge>
            <span className="text-2xl">🍁</span>
          </CardTitle>
          <CardDescription className="mt-1">
            Next Trains - Thanksgiving Edition
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Service Alerts */}
          {data.alerts.length > 0 && (
            <div className="space-y-2">
              {data.alerts.map((alert) => (
                <Alert key={alert.id} variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{alert.headerText}</AlertTitle>
                  {alert.descriptionText && (
                    <AlertDescription>{alert.descriptionText}</AlertDescription>
                  )}
                </Alert>
              ))}
            </div>
          )}

          {/* Train Arrivals */}
          {data.arrivals.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No trains scheduled at this time
            </div>
          ) : (
            <div className="space-y-2">
              {data.arrivals.map((arrival, index) => {
                const isG = arrival.routeId === 'G';
                const badgeColor = isG 
                  ? 'bg-[#6CBE45] text-white hover:bg-[#6CBE45]/90'
                  : 'bg-[#FF6319] text-white hover:bg-[#FF6319]/90';
                
                const autumnEmojis = ['🍂', '🍁', '🌾'];
                const randomEmoji = autumnEmojis[index % autumnEmojis.length];
                
                return (
                  <div
                    key={`${arrival.tripId}-${index}`}
                    className="flex items-center justify-between p-4 border-2 border-primary/10 rounded-lg hover:bg-accent/20 transition-all hover:shadow-md hover:border-primary/30"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{randomEmoji}</span>
                      <Badge className={`${badgeColor} text-lg px-3 py-1 shadow-md`}>
                        {arrival.routeId}
                      </Badge>
                      <div>
                        <div className="font-semibold">{arrival.destination}</div>
                        {arrival.trainId && (
                          <div className="text-sm text-muted-foreground">
                            Train {arrival.trainId}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">
                        {formatArrivalTime(arrival.arrivalTimeSeconds)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatTime(arrival.arrivalTime)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Last Updated */}
          <div className="text-xs text-muted-foreground text-center pt-2 border-t border-primary/10 mt-4">
            <div className="flex items-center justify-center gap-2">
              <span>🦃</span>
              <span>Last updated: {new Date(data.lastUpdated * 1000).toLocaleTimeString()}</span>
              <span>🦃</span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Footer Message */}
      <div className="mt-4 text-center text-sm text-muted-foreground">
        <p className="flex items-center justify-center gap-2">
          <span>🥧</span>
          <span>Have a wonderful Thanksgiving!</span>
          <span>🥧</span>
        </p>
      </div>
    </div>
  );
}

