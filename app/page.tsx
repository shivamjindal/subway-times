import { SubwayTimesDisplay } from '@/components/subway-times-display';
import { SettingsButton } from '@/components/settings-button';

export default function Home() {
  return (
    <main className="min-h-screen bg-background py-8">
      <div className="fixed top-4 right-4 z-50">
        <SettingsButton />
      </div>
      <SubwayTimesDisplay />
    </main>
  );
}
