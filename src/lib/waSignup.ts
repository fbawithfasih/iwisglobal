// The line staff can add to a WhatsApp reply to invite a guest to the email list. It is only ever inserted by a
// person who chooses to, never added automatically. The link opens the /subscribe page (tagged src=whatsapp so the
// signup is recorded as coming from WhatsApp); the guest still confirms by email and can unsubscribe any time.

export const SIGNUP_LANGS = ['en', 'de', 'fr', 'es'] as const;
export type SignupLang = (typeof SIGNUP_LANGS)[number];

export const signupLink = (locale: string): string => `https://www.iwisglobal.com/subscribe?src=whatsapp${locale && locale !== 'en' ? `&lang=${locale}` : ''}`;

const LINE: Record<SignupLang, string> = {
  en: 'If you would like occasional Agra and Taj Mahal travel ideas by email, you can sign up here (you confirm your address first and can unsubscribe any time): {link}',
  de: 'Wenn Sie gelegentlich Reiseideen zu Agra und dem Taj Mahal per E-Mail erhalten möchten, können Sie sich hier anmelden (Sie bestätigen Ihre Adresse zuerst und können sich jederzeit abmelden): {link}',
  fr: "Si vous souhaitez recevoir de temps en temps des idées de voyage sur Agra et le Taj Mahal par e-mail, vous pouvez vous inscrire ici (vous confirmez d'abord votre adresse et pouvez vous désabonner à tout moment) : {link}",
  es: 'Si quieres recibir de vez en cuando ideas de viaje sobre Agra y el Taj Mahal por correo, puedes apuntarte aquí (primero confirmas tu dirección y puedes darte de baja cuando quieras): {link}',
};

export function signupMessage(locale: string): string {
  const l = (SIGNUP_LANGS as readonly string[]).includes(locale) ? (locale as SignupLang) : 'en';
  return LINE[l].replace('{link}', signupLink(l));
}
