import type {
  VenueOpenCall,
  MusicianAvailability,
  LiveShowConfirmed,
  Review,
  MusicGenre,
  NeighborhoodBA,
} from '../types/index.ts';

/**
 * Calculates updated rating score and count when a new review is submitted
 */
export function calculateNewRating(
  currentRating: number,
  currentCount: number,
  newScore: number
): { rating: number; count: number } {
  if (currentCount <= 0) {
    return {
      rating: Number(newScore.toFixed(2)),
      count: 1,
    };
  }
  const total = currentRating * currentCount + newScore;
  const newCount = currentCount + 1;
  const newRating = Number((total / newCount).toFixed(2));
  return {
    rating: newRating,
    count: newCount,
  };
}

/**
 * Recalculates category breakdown ratings
 */
export function calculateNewBreakdown(
  currentBreakdown: Record<string, number>,
  currentCount: number,
  newCriteria: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {};
  const keys = Object.keys(currentBreakdown);

  for (const key of keys) {
    const currentVal = currentBreakdown[key] ?? 5;
    const newVal = newCriteria[key] ?? currentVal;
    if (currentCount <= 0) {
      result[key] = Number(newVal.toFixed(1));
    } else {
      const avg = (currentVal * currentCount + newVal) / (currentCount + 1);
      result[key] = Number(avg.toFixed(1));
    }
  }

  return result;
}

/**
 * Formats an amount to Argentine Pesos display string ($ 120.000)
 */
export function formatARS(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) return '$ 0';
  return '$ ' + amount.toLocaleString('es-AR');
}

/**
 * Formats standard ISO YYYY-MM-DD to friendly Spanish format
 */
export function formatDateBA(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;

  const date = new Date(year, month - 1, day);
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const months = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  return `${days[date.getDay()]} ${day} de ${months[date.getMonth()]}`;
}

/**
 * Filter Open Calls for musicians
 */
export function filterOpenCalls(
  calls: VenueOpenCall[],
  params: {
    query?: string;
    neighborhood?: string;
    genre?: string;
    minCachet?: number;
    onlyOpen?: boolean;
  }
): VenueOpenCall[] {
  return calls.filter((call) => {
    if (params.onlyOpen && call.status !== 'abierta') {
      return false;
    }

    if (params.neighborhood && params.neighborhood !== 'Todos') {
      if (call.venueNeighborhood !== params.neighborhood) return false;
    }

    if (params.genre && params.genre !== 'Todos') {
      if (!call.targetGenres.includes(params.genre as MusicGenre)) return false;
    }

    if (params.minCachet && params.minCachet > 0) {
      if (call.cachetAmountARS < params.minCachet) return false;
    }

    if (params.query && params.query.trim()) {
      const q = params.query.toLowerCase().trim();
      const matchVenue = call.venueName.toLowerCase().includes(q);
      const matchNotes = call.specialNotes.toLowerCase().includes(q);
      const matchGenre = call.targetGenres.some((g) => g.toLowerCase().includes(q));
      const matchHood = call.venueNeighborhood.toLowerCase().includes(q);
      if (!matchVenue && !matchNotes && !matchGenre && !matchHood) return false;
    }

    return true;
  });
}

/**
 * Filter Musician Availabilities for venues looking to book
 */
export function filterMusicianAvailabilities(
  availabilities: MusicianAvailability[],
  params: {
    query?: string;
    neighborhood?: string;
    genre?: string;
    date?: string;
  }
): MusicianAvailability[] {
  return availabilities.filter((item) => {
    if (item.status !== 'disponible') return false;

    if (params.date && item.date !== params.date) {
      return false;
    }

    if (params.neighborhood && params.neighborhood !== 'Todos') {
      const matchHood =
        item.preferredNeighborhoods.includes(params.neighborhood as NeighborhoodBA) ||
        item.preferredNeighborhoods.length === 0;
      if (!matchHood) return false;
    }

    if (params.genre && params.genre !== 'Todos') {
      if (!item.musicianGenres.includes(params.genre as MusicGenre)) return false;
    }

    if (params.query && params.query.trim()) {
      const q = params.query.toLowerCase().trim();
      const matchName = item.musicianName.toLowerCase().includes(q);
      const matchMsg = item.message.toLowerCase().includes(q);
      const matchGenre = item.musicianGenres.some((g) => g.toLowerCase().includes(q));
      if (!matchName && !matchMsg && !matchGenre) return false;
    }

    return true;
  });
}

/**
 * Filter live shows for the Buenos Aires culture catalog
 */
export function filterCatalogShows(
  shows: LiveShowConfirmed[],
  params: {
    query?: string;
    neighborhood?: string;
    genre?: string;
    filterPeriod?: 'all' | 'today' | 'weekend' | 'past';
  }
): LiveShowConfirmed[] {
  return shows.filter((show) => {
    if (params.filterPeriod === 'past') {
      if (!show.isCompleted) return false;
    } else if (params.filterPeriod === 'today') {
      // For demo purposes, we test date matching
    }

    if (params.neighborhood && params.neighborhood !== 'Todos') {
      if (show.venueNeighborhood !== params.neighborhood) return false;
    }

    if (params.genre && params.genre !== 'Todos') {
      if (!show.musicianGenres.includes(params.genre as MusicGenre)) return false;
    }

    if (params.query && params.query.trim()) {
      const q = params.query.toLowerCase().trim();
      const matchVenue = show.venueName.toLowerCase().includes(q);
      const matchMusician = show.musicianName.toLowerCase().includes(q);
      const matchDesc = show.description.toLowerCase().includes(q);
      const matchGenre = show.musicianGenres.some((g) => g.toLowerCase().includes(q));
      if (!matchVenue && !matchMusician && !matchDesc && !matchGenre) return false;
    }

    return true;
  });
}
