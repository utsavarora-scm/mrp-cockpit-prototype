import { NotBuiltYet } from '@/components/general/NotBuiltYet';

export default function Page() {
  return (
    <NotBuiltYet
      title='Agent Activity Log'
      purpose='What closed itself overnight, under policy you write and can reverse.'
      willShow={[
        'The policy rules, editable: value ceiling, confidence floor, allowed exception codes, allowed resolution types, ABC classes.',
        'A chronological feed of every automatic action, with the rule that fired and the simulated impact.',
        'A reverse button on each entry, backed by the session change log.',
        'A planner-hours-saved counter whose minutes-per-exception assumption is visible and editable, not smuggled into a headline.',
      ]}
      dataReady='The policy is defined and applied today — every exception already carries an auto-resolvable flag, and the cockpit KPI strip reports the share. The session change log records who applied what and supports reversal.'
    />
  );
}
