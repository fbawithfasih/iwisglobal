import { Fragment, type ReactNode } from 'react';

// Fills "{name}" placeholders in a translated sentence with React nodes, so a
// sentence like "Visiting hours end around {time} today." can keep the time
// in bold whatever order the language puts the words in.
export function fmtNode(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key !== undefined && key in values ? values[key] : part}</Fragment>;
  });
}
