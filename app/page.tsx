import { SubwayTimesDisplay } from '@/components/subway-times-display';
import { ThemeToggle } from '@/components/theme-toggle';

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-8">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <SubwayTimesDisplay />
    </main>
  );
}
