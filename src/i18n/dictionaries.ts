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
    curatedTitle: 'Just your group',
    curatedDesc: 'Every tour is private to your group, with your own guide — never a crowded bus tour.',
    bookTitle: 'Book until 9 PM the night before',
    bookDesc: 'For the next day, book by 9 PM India time. No tours on Fridays, when the Taj Mahal is closed.',
    pricingTitle: 'Transparent pricing',
    pricingDesc: 'No hidden fees. The price you see is what you pay.',
    promiseTitle: 'Our promise',
    promiseDesc: 'Free cancellation until 24h before, instant confirmation.',
  },
  switcher: { language: 'Language', currency: 'Currency' },
  recommendations: { title: 'Our Taj Mahal tours' },
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
    curatedTitle: 'Solo tu grupo',
    curatedDesc: 'Todos los tours son privados para tu grupo, con tu propio guía — nunca un autobús abarrotado.',
    bookTitle: 'Reserva hasta las 9 p. m. del día anterior',
    bookDesc: 'Para el día siguiente, reserva antes de las 9 p. m. (hora de India). No hay tours los viernes, cuando el Taj Mahal cierra.',
    pricingTitle: 'Precios transparentes',
    pricingDesc: 'Sin cargos ocultos. El precio que ves es el que pagas.',
    promiseTitle: 'Nuestra promesa',
    promiseDesc: 'Cancelación gratuita hasta 24 horas antes, confirmación instantánea.',
  },
  switcher: { language: 'Idioma', currency: 'Moneda' },
  recommendations: { title: 'Nuestros tours al Taj Mahal' },
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
    curatedTitle: 'Rien que votre groupe',
    curatedDesc: 'Chaque visite est privée pour votre groupe, avec votre propre guide — jamais un car bondé.',
    bookTitle: "Réservez jusqu'à 21h la veille",
    bookDesc: "Pour le lendemain, réservez avant 21h (heure de l'Inde). Pas de visite le vendredi, jour de fermeture du Taj Mahal.",
    pricingTitle: 'Tarifs transparents',
    pricingDesc: 'Aucuns frais cachés. Le prix affiché est le prix payé.',
    promiseTitle: 'Notre engagement',
    promiseDesc: "Annulation gratuite jusqu'à 24h avant, confirmation instantanée.",
  },
  switcher: { language: 'Langue', currency: 'Devise' },
  recommendations: { title: 'Nos visites du Taj Mahal' },
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
    curatedTitle: 'Nur Ihre Gruppe',
    curatedDesc: 'Jede Tour ist privat für Ihre Gruppe, mit eigenem Guide — nie ein überfüllter Reisebus.',
    bookTitle: 'Buchbar bis 21 Uhr am Vorabend',
    bookDesc: 'Für den nächsten Tag bis 21 Uhr indischer Zeit buchen. Freitags keine Touren, da das Taj Mahal geschlossen ist.',
    pricingTitle: 'Transparente Preise',
    pricingDesc: 'Keine versteckten Gebühren. Der angezeigte Preis ist der Preis, den Sie zahlen.',
    promiseTitle: 'Unser Versprechen',
    promiseDesc: 'Kostenlose Stornierung bis 24 Stunden vorher, sofortige Bestätigung.',
  },
  switcher: { language: 'Sprache', currency: 'Währung' },
  recommendations: { title: 'Unsere Taj-Mahal-Touren' },
  thingsToDo: { title: 'Top-Aktivitäten in Agra' },
};

const dictionaries: Record<Locale, Dictionary> = { en, es, fr, de };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
