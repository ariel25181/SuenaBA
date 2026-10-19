export type UserRole = 'musico' | 'bar' | 'espectador';

export type NeighborhoodBA =
  | 'Palermo Soho'
  | 'Palermo Hollywood'
  | 'San Telmo'
  | 'Colegiales'
  | 'Villa Crespo'
  | 'Almagro'
  | 'San Nicolás (Centro)'
  | 'Recoleta'
  | 'Chacarita'
  | 'Belgrano'
  | 'Barracas';

export type MusicGenre =
  | 'Jazz'
  | 'Rock'
  | 'Acústico'
  | 'Tango & Fusión'
  | 'Indie'
  | 'Bossa & MPB'
  | 'Blues & Soul'
  | 'Folklore'
  | 'Funk & Groove'
  | 'Pop';

export interface Review {
  id: string;
  targetType: 'musician' | 'venue';
  targetId: string;
  authorType: 'venue' | 'musician';
  authorId: string;
  authorName: string;
  authorAvatar: string;
  showDate: string;
  showVenueName: string;
  rating: number; // 1 to 5
  criteriaBreakdown: Record<string, number>;
  comment: string;
  tags: string[];
  createdAt: string;
}

export interface VenueProfile {
  id: string;
  name: string;
  type: 'Bar de Copas' | 'Restaurante Bistro' | 'Club de Jazz' | 'Cervecería' | 'Espacio Cultural';
  address: string;
  neighborhood: NeighborhoodBA;
  coverPhoto: string;
  photos: string[];
  bio: string;
  capacity: number;
  backline: string[];
  acousticCharacteristics: string;
  hospitality: string;
  rating: number;
  reviewCount: number;
  ratingBreakdown: {
    soundQuality: number;
    paymentReliability: number;
    hospitality: number;
    respect: number;
  };
  reviews: Review[];
}

export interface MusicianProfile {
  id: string;
  stageName: string;
  format: 'Solista' | 'Dúo' | 'Trío' | 'Cuarteto' | 'Banda Completa (5+)';
  genres: MusicGenre[];
  bio: string;
  avatarUrl: string;
  photos: string[];
  membersCount: number;
  instagramHandle: string;
  spotifyDemoTitle?: string;
  youtubeSampleUrl?: string;
  minCachetDefault: number;
  technicalRider: string;
  rating: number;
  reviewCount: number;
  ratingBreakdown: {
    punctuality: number;
    liveSound: number;
    crowdDrawing: number;
    professionalism: number;
  };
  reviews: Review[];
}

export interface Application {
  id: string;
  callId: string;
  musicianId: string;
  musicianName: string;
  musicianAvatar: string;
  genres: MusicGenre[];
  format: string;
  proposedCachetARS: number;
  note: string;
  demoTrackTitle: string;
  status: 'pendiente' | 'aceptada' | 'rechazada';
  createdAt: string;
}

export interface DirectOffer {
  id: string;
  availabilityId: string;
  venueId: string;
  venueName: string;
  venueNeighborhood: NeighborhoodBA;
  venueAvatar: string;
  date: string;
  offeredCachetARS: number;
  note: string;
  status: 'pendiente' | 'aceptada' | 'rechazada';
  createdAt: string;
}

export interface VenueOpenCall {
  id: string;
  venueId: string;
  venueName: string;
  venueNeighborhood: NeighborhoodBA;
  venueAvatar: string;
  date: string; // YYYY-MM-DD
  soundcheckTime: string;
  showTime: string;
  targetGenres: MusicGenre[];
  targetFormats: string[];
  cachetType: 'fijo' | 'fijo_mas_consumo' | 'taquilla' | 'a_convenir';
  cachetAmountARS: number;
  cachetDetails: string;
  providedBackline: string[];
  specialNotes: string;
  status: 'abierta' | 'cerrada_confirmada';
  confirmedMusicianId?: string;
  confirmedMusicianName?: string;
  applications: Application[];
  createdAt: string;
}

export interface MusicianAvailability {
  id: string;
  musicianId: string;
  musicianName: string;
  musicianAvatar: string;
  musicianFormat: string;
  musicianGenres: MusicGenre[];
  date: string; // YYYY-MM-DD
  timeSlot: 'tarde' | 'noche' | 'trasnoche' | 'todo_el_dia';
  preferredNeighborhoods: NeighborhoodBA[];
  expectedCachetARS: number;
  message: string;
  status: 'disponible' | 'reservado';
  directOffers: DirectOffer[];
  createdAt: string;
}

export interface LiveShowConfirmed {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  venueId: string;
  venueName: string;
  venueAddress: string;
  venueNeighborhood: NeighborhoodBA;
  venuePhoto: string;
  musicianId: string;
  musicianName: string;
  musicianGenres: MusicGenre[];
  musicianFormat: string;
  musicianAvatar: string;
  ticketType: 'entrada_libre' | 'consumicion_minima' | 'ticket_fijo';
  ticketPriceARS: number;
  description: string;
  isCompleted: boolean;
  venueReviewed: boolean;
  musicianReviewed: boolean;
}
