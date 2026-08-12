import { NotBuiltYet } from '@/components/general/NotBuiltYet';

export default function Page() {
  return (
    <NotBuiltYet
      title='Three-System Reconciliation Monitor'
      purpose='The seam between SAP, Kinaxis and o9 — every fact the three systems disagree about, and what that disagreement costs.'
      willShow={[
        'Three system cards with last sync, record counts and health, read from the adapters.',
        'A divergence table: one row per disagreeing fact, all three values side by side, the delta, the business impact and a recommended source of truth with its reasoning.',
        'A 30-day timeline showing that divergence is chronic rather than incidental.',
        'The positioning line, on the screen itself: three systems, three versions of the truth, and nobody owns the seam.',
      ]}
      dataReady='Every class-C exception is already generated — demand divergence, inventory divergence, parameter drift across systems, plans that never reached execution, and stale sync. They are in the cockpit queue now.'
    />
  );
}
