// Translated UI chrome strings (see src/lib/i18n.ts for scope). These are
// machine translations, not reviewed by a native speaker — accurate enough
// to ship a working switcher, but worth a native-speaker pass before
// treating them as final, especially anywhere near pricing/policy language.

import type { Locale } from '../lib/i18n';

export interface Dictionary {
  nav: {
    tours: string;
    blog: string;
    help: string;
    signIn: string;
    myBookings: string;
    signOut: string;
  };
  hero: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
  };
  trust: {
    curatedTitle: string;
    curatedDesc: string;
    bookTitle: string;
    bookDesc: string;
    pricingTitle: string;
    pricingDesc: string;
    promiseTitle: string;
    promiseDesc: string;
  };
  switcher: {
    language: string;
    currency: string;
  };
  recommendations: {
    title: string;
  };
  thingsToDo: {
    title: string;
  };
}

const en: Dictionary = {
  nav: { tours: 'Tours', blog: 'Blog', help: 'Help', signIn: 'Sign in', myBookings: 'My Bookings', signOut: 'Sign out' },
  hero: {
    title: 'The Taj Mahal, curated just for you.',
    subtitle:
      'Private Taj Mahal & Agra tours from Delhi — your own English-speaking guide and private car, hotel pickup included, and free cancellation up to 24 hours before.',
    searchPlaceholder: 'Search tours in Agra',
  },
  trust: {
    curatedTitle: 'Curated, not crowded',
    curatedDesc: 'Small, private tours — not another crowded bus circuit.',
    bookTitle: 'Book anytime',
    bookDesc: 'Book by 9 PM India time the night before, or plan ahead — your call.',
    pricingTitle: 'Transparent pricing',
    pricingDesc: 'No hidden fees. The price you see is what you pay.',
    promiseTitle: 'Our promise',
    promiseDesc: 'Free cancellation until 24h before, instant confirmation.',
  },
  switcher: { language: 'Language', currency: 'Currency' },
  recommendations: { title: 'IWIS Top Recommendations' },
  thingsToDo: { title: 'Top things to do in Agra' },
};

const es: Dictionary = {
  nav: { tours: 'Tours', blog: 'Blog', help: 'Ayuda', signIn: 'Iniciar sesión', myBookings: 'Mis reservas', signOut: 'Cerrar sesión' },
  hero: {
    title: 'El Taj Mahal, diseñado para ti.',
    subtitle:
      'Tours privados al Taj Mahal y Agra desde Delhi: tu propio guía de habla inglesa y coche privado, recogida en el hotel incluida y cancelación gratuita hasta 24 horas antes.',
    searchPlaceholder: 'Buscar tours en Agra',
  },
  trust: {
    curatedTitle: 'Seleccionados, no masificados',
    curatedDesc: 'Tours privados y reducidos, no otro circuito de autobús abarrotado.',
    bookTitle: 'Reserva cuando quieras',
    bookDesc: 'Reserva antes de las 9 p. m. (hora de India) de la noche anterior, o planifica con antelación — tú decides.',
    pricingTitle: 'Precios transparentes',
    pricingDesc: 'Sin cargos ocultos. El precio que ves es el que pagas.',
    promiseTitle: 'Nuestra promesa',
    promiseDesc: 'Cancelación gratuita hasta 24 horas antes, confirmación instantánea.',
  },
  switcher: { language: 'Idioma', currency: 'Moneda' },
  recommendations: { title: 'Las mejores recomendaciones de IWIS' },
  thingsToDo: { title: 'Las mejores cosas que hacer en Agra' },
};

const fr: Dictionary = {
  nav: { tours: 'Circuits', blog: 'Blog', help: 'Aide', signIn: 'Se connecter', myBookings: 'Mes réservations', signOut: 'Se déconnecter' },
  hero: {
    title: 'Le Taj Mahal, pensé pour vous.',
    subtitle:
      "Circuits privés au Taj Mahal et à Agra depuis Delhi — votre propre guide anglophone et voiture privée, prise en charge à l'hôtel incluse et annulation gratuite jusqu'à 24 heures avant.",
    searchPlaceholder: 'Rechercher des circuits à Agra',
  },
  trust: {
    curatedTitle: 'Sélectionné, pas bondé',
    curatedDesc: "Des circuits privés et réduits, pas un énième circuit en bus bondé.",
    bookTitle: 'Réservez à tout moment',
    bookDesc: "Réservez avant 21h (heure de l'Inde) la veille, ou planifiez à l'avance — à vous de choisir.",
    pricingTitle: 'Tarifs transparents',
    pricingDesc: 'Aucuns frais cachés. Le prix affiché est le prix payé.',
    promiseTitle: 'Notre engagement',
    promiseDesc: "Annulation gratuite jusqu'à 24h avant, confirmation instantanée.",
  },
  switcher: { language: 'Langue', currency: 'Devise' },
  recommendations: { title: "Les meilleures recommandations d'IWIS" },
  thingsToDo: { title: 'Les meilleures choses à faire à Agra' },
};

const de: Dictionary = {
  nav: { tours: 'Touren', blog: 'Blog', help: 'Hilfe', signIn: 'Anmelden', myBookings: 'Meine Buchungen', signOut: 'Abmelden' },
  hero: {
    title: 'Das Taj Mahal, ganz nach Ihren Wünschen.',
    subtitle:
      'Private Taj-Mahal- und Agra-Touren ab Delhi — Ihr eigener englischsprachiger Guide und Privatwagen, Hotelabholung inklusive und kostenlose Stornierung bis 24 Stunden vorher.',
    searchPlaceholder: 'Touren in Agra suchen',
  },
  trust: {
    curatedTitle: 'Ausgewählt, nicht überfüllt',
    curatedDesc: 'Kleine, private Touren — keine weitere überfüllte Bustour.',
    bookTitle: 'Jederzeit buchbar',
    bookDesc: 'Bis 21 Uhr indischer Zeit am Vorabend buchen, oder im Voraus planen — Sie entscheiden.',
    pricingTitle: 'Transparente Preise',
    pricingDesc: 'Keine versteckten Gebühren. Der angezeigte Preis ist der Preis, den Sie zahlen.',
    promiseTitle: 'Unser Versprechen',
    promiseDesc: 'Kostenlose Stornierung bis 24 Stunden vorher, sofortige Bestätigung.',
  },
  switcher: { language: 'Sprache', currency: 'Währung' },
  recommendations: { title: 'IWIS Top-Empfehlungen' },
  thingsToDo: { title: 'Top-Aktivitäten in Agra' },
};

const dictionaries: Record<Locale, Dictionary> = { en, es, fr, de };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
