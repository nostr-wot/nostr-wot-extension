/** A labelled value shared by selection controls; no rendering or behavior. */
export interface Option<T extends string | number = string> {
  value: T;
  label: string;
}
