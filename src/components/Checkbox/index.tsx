import type { InputHTMLAttributes } from 'react';
/** Native selection control using the active theme's accent and focus tokens. */
export default function Checkbox(props:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>) {
 return <input {...props} type="checkbox" className="size-5 m-0 accent-brand cursor-pointer focus-visible:outline focus-visible:outline-brand disabled:cursor-not-allowed"/>;
}
