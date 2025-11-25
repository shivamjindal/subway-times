import { SubwayTimesDisplay } from '@/components/subway-times-display';

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-8 relative overflow-hidden">
      {/* Decorative autumn leaves background */}
      <div className="absolute inset-0 pointer-events-none opacity-5">
        <div className="absolute top-10 left-10 text-6xl">🍁</div>
        <div className="absolute top-20 right-20 text-5xl">🍂</div>
        <div className="absolute bottom-20 left-20 text-7xl">🦃</div>
        <div className="absolute bottom-10 right-10 text-6xl">🥧</div>
        <div className="absolute top-1/2 left-1/4 text-5xl">🌾</div>
        <div className="absolute top-1/3 right-1/3 text-6xl">🍁</div>
      </div>
      <SubwayTimesDisplay />
    </main>
  );
}
