export const NIP06_PATH: string = "m/44'/1237'/0'/0/0";

export const MAX_BIP32_INDEX = 0x7fffffff;
export const MAX_BIP32_DEPTH = 255;
export const NIP06_ACCOUNT_PREFIX = NIP06_PATH.slice(0, NIP06_PATH.lastIndexOf('/') + 1);

export const MAX_BIP32_PATH_LENGTH = 2 + MAX_BIP32_DEPTH * 12;
