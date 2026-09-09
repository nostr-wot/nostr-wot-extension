import { secp256k1 } from '@noble/curves/secp256k1.js';

export const N: bigint = secp256k1.Point.Fn.ORDER;

export const P: bigint = secp256k1.Point.Fp.ORDER;
