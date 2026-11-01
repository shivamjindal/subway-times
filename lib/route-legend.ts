export function isExpressRoute(routeId: string): boolean {
  return routeId.length > 1 && routeId.endsWith('X');
}

export function getRouteKeyCaption(routeId: string): string {
  if (isExpressRoute(routeId)) {
    return `${routeId} is the express version of the ${routeId.slice(0, -1)}: it skips stops, mostly at rush hour`;
  }
  return `${routeId} train`;
}

export function getDirectionName(direction: 'N' | 'S'): 'Uptown' | 'Downtown' {
  return direction === 'N' ? 'Uptown' : 'Downtown';
}
