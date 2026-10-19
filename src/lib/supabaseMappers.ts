import type {
  VenueProfile,
  MusicianProfile,
  VenueOpenCall,
  MusicianAvailability,
  LiveShowConfirmed,
} from '../types/index.ts';

/**
 * Supabase devuelve columnas en snake_case (cover_photo, rating_breakdown...)
 * pero la app trabaja en camelCase. Estas funciones convierten cada fila y
 * completan valores por defecto para que la UI nunca reciba `undefined`
 * (por ejemplo ratingBreakdown.soundQuality), que provocaba la pantalla negra.
 */

type Row = Record<string, any>;

const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** Lee un campo aceptando camelCase o snake_case. */
function pick<T>(row: Row, camelKey: string, fallback: T): T {
  const snakeKey = camelKey.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const value = row[camelKey] ?? row[snakeKey];
  return (value === null || value === undefined ? fallback : value) as T;
}

const num = (value: unknown, fallback: number): number => {
  const n = typeof value === 'string' ? parseFloat(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

const arr = <T = string>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Convierte las claves de un objeto jsonb (primer nivel) a camelCase. */
function camelKeys(obj: unknown): Row {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Row = {};
  for (const [k, v] of Object.entries(obj as Row)) out[toCamel(k)] = v;
  return out;
}

function mergeBreakdown<T extends Record<string, number>>(defaults: T, raw: unknown): T {
  const src = camelKeys(raw);
  const result: Record<string, number> = {};
  for (const key of Object.keys(defaults)) {
    result[key] = num(src[key], defaults[key]);
  }
  return result as T;
}

export function mapVenue(row: Row): VenueProfile {
  const photo = pick<string>(row, 'coverPhoto', '');
  return {
    id: String(row.id),
    name: pick(row, 'name', 'Bar sin nombre'),
    type: pick(row, 'type', 'Bar de Copas'),
    address: pick(row, 'address', ''),
    neighborhood: pick(row, 'neighborhood', 'Palermo Soho'),
    coverPhoto: photo,
    photos: arr(pick(row, 'photos', [])),
    bio: pick(row, 'bio', ''),
    capacity: num(row.capacity, 100),
    backline: arr(pick(row, 'backline', [])),
    acousticCharacteristics: pick(row, 'acousticCharacteristics', ''),
    hospitality: pick(row, 'hospitality', ''),
    rating: num(row.rating, 5),
    reviewCount: num(pick(row, 'reviewCount', 0), 0),
    ratingBreakdown: mergeBreakdown(
      { soundQuality: 5, paymentReliability: 5, hospitality: 5, respect: 5 },
      pick(row, 'ratingBreakdown', {})
    ),
    reviews: arr(pick(row, 'reviews', [])),
  };
}

export function mapMusician(row: Row): MusicianProfile {
  return {
    id: String(row.id),
    stageName: pick(row, 'stageName', 'Músico sin nombre'),
    format: pick(row, 'format', 'Solista'),
    genres: arr(pick(row, 'genres', [])),
    bio: pick(row, 'bio', ''),
    avatarUrl: pick(row, 'avatarUrl', ''),
    photos: arr(pick(row, 'photos', [])),
    membersCount: num(pick(row, 'membersCount', 1), 1),
    instagramHandle: pick(row, 'instagramHandle', ''),
    spotifyDemoTitle: pick<string | undefined>(row, 'spotifyDemoTitle', undefined),
    youtubeSampleUrl: pick<string | undefined>(row, 'youtubeSampleUrl', undefined),
    minCachetDefault: num(pick(row, 'minCachetDefault', 100000), 100000),
    technicalRider: pick(row, 'technicalRider', ''),
    rating: num(row.rating, 5),
    reviewCount: num(pick(row, 'reviewCount', 0), 0),
    ratingBreakdown: mergeBreakdown(
      { punctuality: 5, liveSound: 5, crowdDrawing: 5, professionalism: 5 },
      pick(row, 'ratingBreakdown', {})
    ),
    reviews: arr(pick(row, 'reviews', [])),
  };
}

export function mapOpenCall(row: Row): VenueOpenCall {
  return {
    id: String(row.id),
    venueId: pick(row, 'venueId', ''),
    venueName: pick(row, 'venueName', ''),
    venueNeighborhood: pick(row, 'venueNeighborhood', 'Palermo Soho'),
    venueAvatar: pick(row, 'venueAvatar', ''),
    date: pick(row, 'date', ''),
    soundcheckTime: pick(row, 'soundcheckTime', ''),
    showTime: pick(row, 'showTime', ''),
    targetGenres: arr(pick(row, 'targetGenres', [])),
    targetFormats: arr(pick(row, 'targetFormats', [])),
    cachetType: pick(row, 'cachetType', 'fijo_mas_consumo'),
    cachetAmountARS: num(pick(row, 'cachetAmountArs', 0), 0),
    cachetDetails: pick(row, 'cachetDetails', ''),
    providedBackline: arr(pick(row, 'providedBackline', [])),
    specialNotes: pick(row, 'specialNotes', ''),
    status: pick(row, 'status', 'abierta'),
    confirmedMusicianId: pick<string | undefined>(row, 'confirmedMusicianId', undefined),
    confirmedMusicianName: pick<string | undefined>(row, 'confirmedMusicianName', undefined),
    applications: arr(pick(row, 'applications', [])),
    createdAt: pick(row, 'createdAt', ''),
  };
}

export function mapAvailability(row: Row): MusicianAvailability {
  return {
    id: String(row.id),
    musicianId: pick(row, 'musicianId', ''),
    musicianName: pick(row, 'musicianName', ''),
    musicianAvatar: pick(row, 'musicianAvatar', ''),
    musicianFormat: pick(row, 'musicianFormat', ''),
    musicianGenres: arr(pick(row, 'musicianGenres', [])),
    date: pick(row, 'date', ''),
    timeSlot: pick(row, 'timeSlot', 'noche'),
    preferredNeighborhoods: arr(pick(row, 'preferredNeighborhoods', [])),
    expectedCachetARS: num(pick(row, 'expectedCachetArs', 0), 0),
    message: pick(row, 'message', ''),
    status: pick(row, 'status', 'disponible'),
    directOffers: arr(pick(row, 'directOffers', [])),
    createdAt: pick(row, 'createdAt', ''),
  };
}

export function mapLiveShow(row: Row): LiveShowConfirmed {
  return {
    id: String(row.id),
    date: pick(row, 'date', ''),
    time: pick(row, 'time', ''),
    venueId: pick(row, 'venueId', ''),
    venueName: pick(row, 'venueName', ''),
    venueAddress: pick(row, 'venueAddress', ''),
    venueNeighborhood: pick(row, 'venueNeighborhood', 'Palermo Soho'),
    venuePhoto: pick(row, 'venuePhoto', ''),
    musicianId: pick(row, 'musicianId', ''),
    musicianName: pick(row, 'musicianName', ''),
    musicianGenres: arr(pick(row, 'musicianGenres', [])),
    musicianFormat: pick(row, 'musicianFormat', ''),
    musicianAvatar: pick(row, 'musicianAvatar', ''),
    ticketType: pick(row, 'ticketType', 'consumicion_minima'),
    ticketPriceARS: num(pick(row, 'ticketPriceArs', 0), 0),
    description: pick(row, 'description', ''),
    isCompleted: Boolean(pick(row, 'isCompleted', false)),
    venueReviewed: Boolean(pick(row, 'venueReviewed', false)),
    musicianReviewed: Boolean(pick(row, 'musicianReviewed', false)),
  };
}
