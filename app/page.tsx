import { SubwayTimesDisplay } from '@/components/subway-times-display';
import { ThemeToggle } from '@/components/theme-toggle';
import { SettingsButton } from '@/components/settings-button';

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-8">
      <div className="fixed top-4 right-4 z-50">
        <div className="relative w-[7.5rem] h-9">
          <span className="absolute inset-0 flex items-center justify-between px-2">
            <ThemeToggle />
            <SettingsButton />
          </span>
        </div>
      </div>
      <SubwayTimesDisplay />
    </main>
  );
}
