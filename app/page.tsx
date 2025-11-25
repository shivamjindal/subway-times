import { SubwayTimesDisplay } from '@/components/subway-times-display';

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        {/* Thanksgiving Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">
            🦃
          </div>
          <h1 className="text-4xl font-bold mb-2 text-primary">
            Happy Thanksgiving!
          </h1>
          <p className="text-lg text-muted-foreground">
            Wishing you safe travels home for the holidays
          </p>
          <div className="flex justify-center gap-4 mt-4 text-3xl">
            🍂 🌽 🥧 🍁
          </div>
        </div>
      </div>
      <SubwayTimesDisplay />
    </main>
  );
}
