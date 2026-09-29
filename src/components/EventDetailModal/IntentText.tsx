import type { IntentPart } from '@services/i18n/eventIntent';

/** Theme-aware emphasis shared by single requests and grouped summaries. */
export default function IntentText({parts}:{parts:IntentPart[]}) {
  return <span className="text-secondary font-normal [overflow-wrap:anywhere]">{parts.map((part,index)=>
    part.accent ? <span key={index} className="text-brand font-medium">{part.text}</span> : part.text
  )}</span>;
}
