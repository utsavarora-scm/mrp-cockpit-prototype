import { NotBuiltYet } from '@/components/general/NotBuiltYet';

export default function Page() {
  return (
    <NotBuiltYet
      title='Scenario Compare'
      purpose='Two to four plans side by side, so a choice between them is made on numbers rather than on argument.'
      willShow={[
        'Baseline, observed lead times, committed resolutions and a demand-upside case, compared on one KPI matrix.',
        'Exception counts by class for each scenario.',
        'A service-versus-inventory frontier, which is where the trade-off actually lives.',
        'Clone, branch and promote, so a scenario can become the working plan.',
      ]}
      dataReady='The session already models scenarios and the engine already re-runs against any of them — the observed-lead-time scenario is what powers the master-data-decay comparison.'
    />
  );
}
