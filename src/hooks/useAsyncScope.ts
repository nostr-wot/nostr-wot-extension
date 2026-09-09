import { useEffect, useMemo, type DependencyList } from 'react';
import { createAsyncScope } from '@utils/asyncScope.ts';

/** Retire in-flight results on dependency changes and unmount. */
export default function useAsyncScope(deps: DependencyList = []) {
  const scope = useMemo(createAsyncScope, []);
  useEffect(() => () => scope.invalidate(), [scope, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return scope;
}
