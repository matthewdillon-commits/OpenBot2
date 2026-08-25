/**
 * CRM delivery optionally loads nodemailer. The worker typecheck follows that
 * import through the unattended bootstrap and has no reason to install the mailer.
 */
declare module "nodemailer";
