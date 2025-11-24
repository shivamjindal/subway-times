import { SubwayTimesDisplay } from '@/components/subway-times-display';

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-8 bg-gradient-to-br from-background via-background to-accent/10">
      <SubwayTimesDisplay />
    </main>
  );
}
