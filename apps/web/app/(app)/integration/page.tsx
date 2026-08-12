import { NotBuiltYet } from '@/components/general/NotBuiltYet';

export default function Page() {
  return (
    <NotBuiltYet
      title='Integration Architecture'
      purpose='How this connects, stated plainly enough that an IT audience can check it.'
      willShow={[
        'A live status diagram of the adapter layer, showing which adapter is active and what each reads and writes.',
        'The real endpoint names, payload shapes, record volumes and sync cadence for each system.',
        'The clean-core callout: zero modifications to SAP, zero modifications to Kinaxis, side-by-side extension on standard OData and REST.',
        'What a production deployment would need — credentials, scopes and network routes — rather than implying it already exists.',
      ]}
      dataReady='The adapter layer is built. Real endpoint catalogues, health checks with realistic latencies and record counts, and the writeback payload builders are all working — the writeback preview in the workbench renders from them today.'
    />
  );
}
