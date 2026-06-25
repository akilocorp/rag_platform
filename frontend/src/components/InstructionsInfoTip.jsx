import React from 'react';
import InfoTip from './InfoTip';

// Tooltip for the unified Instructions panel. Explains that plain English works,
// and that you can request JSON / structured output and use [bracket] fill-in
// slots. Shown via the (i) icon next to the field label on the create + edit
// config pages. Kept in one place so both pages stay in sync.
const TIP = (
  <>
    Write plain instructions — or ask for <strong>structured / JSON output</strong>:
    <br />• <strong>[Brackets]</strong> mark fill-in slots: <em>“Greet the student by [name], then explain [topic].”</em>
    <br />• <strong>JSON</strong>:{' '}
    <code className="text-[10px] break-all">{'Reply as JSON: {"answer":"[text]","confidence":[0-100],"sources":["[doc]"]}'}</code>
    <br />• <strong>Lists</strong>: <em>“Return [3] bullet points, each starting with an action verb.”</em>
  </>
);

const InstructionsInfoTip = () => <InfoTip wide text={TIP} />;

export default InstructionsInfoTip;
