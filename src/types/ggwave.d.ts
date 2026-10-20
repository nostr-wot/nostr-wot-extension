declare module 'ggwave' {
  interface Parameters {
    sampleRateInp: number;
    sampleRateOut: number;
    sampleFormatInp: { value: number };
    sampleFormatOut: { value: number };
    operatingMode: number;
    payloadLength: number;
  }
  interface GgWave {
    getDefaultParameters(): Parameters;
    SampleFormat: { GGWAVE_SAMPLE_FORMAT_F32: { value: number }; GGWAVE_SAMPLE_FORMAT_I16: { value: number } };
    GGWAVE_OPERATING_MODE_RX: number;
    init(parameters: Parameters): number;
    decode(instance: number, bytes: Uint8Array): Int8Array;
    free(instance: number): void;
  }
  export default function factory(options?: { print?: (text: string) => void; printErr?: (text: string) => void }): Promise<GgWave>;
}
