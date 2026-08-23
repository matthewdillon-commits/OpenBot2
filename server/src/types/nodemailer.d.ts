declare module "nodemailer" {
  export function createTransport(options: {
    host: string;
    port: number;
    auth?: { user: string; pass: string };
  }): {
    sendMail(mail: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }): Promise<unknown>;
  };
}
