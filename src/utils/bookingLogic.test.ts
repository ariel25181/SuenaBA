import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateNewRating,
  calculateNewBreakdown,
  formatARS,
  formatDateBA,
  filterOpenCalls,
  filterMusicianAvailabilities,
} from './bookingLogic.ts';
import type { VenueOpenCall, MusicianAvailability } from '../types/index.ts';

test('calculateNewRating correctly computes cumulative weighted average', () => {
  // If current rating is 5.0 with 1 review, and new review is 4.0: (5 + 4) / 2 = 4.5
  const res1 = calculateNewRating(5.0, 1, 4.0);
  assert.equal(res1.rating, 4.5);
  assert.equal(res1.count, 2);

  // If first review
  const resFirst = calculateNewRating(0, 0, 4.8);
  assert.equal(resFirst.rating, 4.8);
  assert.equal(resFirst.count, 1);

  // Multiple reviews: 4.8 with 4 reviews (total 19.2) + 5.0 => 24.2 / 5 = 4.84
  const resMulti = calculateNewRating(4.8, 4, 5.0);
  assert.equal(resMulti.rating, 4.84);
  assert.equal(resMulti.count, 5);
});

test('calculateNewBreakdown updates criteria properly', () => {
  const current = { punctuality: 4.0, sound: 5.0 };
  const updated = calculateNewBreakdown(current, 1, { punctuality: 5.0, sound: 3.0 });
  assert.equal(updated.punctuality, 4.5);
  assert.equal(updated.sound, 4.0);
});

test('formatARS outputs formatted currency', () => {
  assert.equal(formatARS(120000), '$ 120.000');
  assert.equal(formatARS(0), '$ 0');
});

test('formatDateBA formats ISO dates properly', () => {
  const formatted = formatDateBA('2026-10-24');
  assert.match(formatted, /24 de Oct/);
});

test('filterOpenCalls filters by neighborhood and genre', () => {
  const dummyCalls: VenueOpenCall[] = [
    {
      id: 'c1',
      venueId: 'v1',
      venueName: 'Thelonious Club',
      venueNeighborhood: 'Palermo Soho',
      venueAvatar: '',
      date: '2026-10-24',
      soundcheckTime: '19:00',
      showTime: '21:30',
      targetGenres: ['Jazz', 'Blues & Soul'],
      targetFormats: ['Trío'],
      cachetType: 'fijo',
      cachetAmountARS: 120000,
      cachetDetails: '120k',
      providedBackline: ['Batería'],
      specialNotes: 'Noche de jazz clásico',
      status: 'abierta',
      applications: [],
      createdAt: '2026-10-18',
    },
    {
      id: 'c2',
      venueId: 'v2',
      venueName: 'Bar de San Telmo',
      venueNeighborhood: 'San Telmo',
      venueAvatar: '',
      date: '2026-10-25',
      soundcheckTime: '19:00',
      showTime: '21:30',
      targetGenres: ['Tango & Fusión', 'Acústico'],
      targetFormats: ['Dúo'],
      cachetType: 'fijo',
      cachetAmountARS: 90000,
      cachetDetails: '90k',
      providedBackline: ['Sonido'],
      specialNotes: 'Milonga acústica',
      status: 'abierta',
      applications: [],
      createdAt: '2026-10-18',
    },
  ];

  const filteredByHood = filterOpenCalls(dummyCalls, { neighborhood: 'Palermo Soho' });
  assert.equal(filteredByHood.length, 1);
  assert.equal(filteredByHood[0].venueName, 'Thelonious Club');

  const filteredByGenre = filterOpenCalls(dummyCalls, { genre: 'Tango & Fusión' });
  assert.equal(filteredByGenre.length, 1);
  assert.equal(filteredByGenre[0].venueName, 'Bar de San Telmo');

  const filteredByMinCachet = filterOpenCalls(dummyCalls, { minCachet: 100000 });
  assert.equal(filteredByMinCachet.length, 1);
  assert.equal(filteredByMinCachet[0].venueName, 'Thelonious Club');
});

test('filterMusicianAvailabilities filters by genre and search', () => {
  const dummyAvails: MusicianAvailability[] = [
    {
      id: 'a1',
      musicianId: 'm1',
      musicianName: 'Cuarteto Porteño',
      musicianAvatar: '',
      musicianFormat: 'Cuarteto',
      musicianGenres: ['Tango & Fusión', 'Acústico'],
      date: '2026-10-24',
      timeSlot: 'noche',
      preferredNeighborhoods: ['San Telmo', 'Palermo Soho'],
      expectedCachetARS: 150000,
      message: 'Disponibles para repertorio de tango moderno',
      status: 'disponible',
      directOffers: [],
      createdAt: '2026-10-18',
    },
  ];

  const results = filterMusicianAvailabilities(dummyAvails, { query: 'Porteño' });
  assert.equal(results.length, 1);

  const emptyResults = filterMusicianAvailabilities(dummyAvails, { query: 'Rock pesado' });
  assert.equal(emptyResults.length, 0);
});
