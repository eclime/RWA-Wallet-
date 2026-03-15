declare module 'qrcode' {
  export type QRCodeToDataURLOptions = {
    margin?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  };

  const QRCode: {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  };

  export default QRCode;
}
