import { NotBuiltYet } from '@/components/general/NotBuiltYet';

export default function Page() {
  return (
    <NotBuiltYet
      title='Master Data Health'
      purpose='The systemic view of parameter decay: which planning masters have rotted, how far, and what that is costing across the network.'
      willShow={[
        'A 0–100 health score per item-plant, with the formula shown on hover rather than asserted.',
        'A heatmap of mean health by item type and site, so the pattern shows up before the detail does.',
        'The absent-items panel: items carrying demand in o9 or Kinaxis with no planning master in SAP at all, and the component cascade behind each one.',
        'One-click fixes on every class-B finding, each opening the same writeback preview the workbench uses.',
      ]}
      dataReady='The engine already produces every class-B exception — incomplete masters, absent items, lead-time drift, safety-stock misalignment, duplicate codes, expiring recipes. The health score is computed today and shown in the Item 360 parameter rail; this screen aggregates it.'
    />
  );
}
