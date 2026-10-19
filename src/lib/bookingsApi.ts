import { supabase } from './supabaseClient.ts';
import type { BookingStatus, BookingMode, CancellationPolicy } from '../domain/bookingRules.ts';
import { errorMessage } from '../domain/bookingRules.ts';

export class BookingError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'BookingError'; }
}

type Row = Record<string, any>;
export interface Listing {
  id: string; venueId: string; startsAt: string; endsAt: string; cachetArs: number; genres: string[]; backline: string[];
  notes: string; bookingMode: BookingMode; cancellationPolicy: CancellationPolicy; status: 'abierta' | 'reservada' | 'cerrada' | 'cancelada';
}
export interface Booking {
  id: string; listingId: string; venueId: string; musicianId: string; status: BookingStatus; cachetArs: number; note: string;
  startsAt: string; endsAt: string; cancellationPolicy: CancellationPolicy; respondBy: string; fundBy: string | null;
  cancelledBy: 'bar' | 'musico' | 'sistema' | null; cancelReason: string | null; disputedAt: string | null;
}
export interface Review { id: string; bookingId: string; authorRole: 'bar' | 'musico'; rating: number; breakdown: Record<string, number>; comment: string; publishedAt: string | null }
export interface Message { id: string; bookingId: string; senderRole: 'bar' | 'musico'; body: string; createdAt: string }

export const mapListing = (r: Row): Listing => ({
  id: r.id, venueId: r.venue_id, startsAt: r.starts_at, endsAt: r.ends_at, cachetArs: Number(r.cachet_ars),
  genres: r.genres ?? [], backline: r.backline ?? [], notes: r.notes ?? '', bookingMode: r.booking_mode,
  cancellationPolicy: r.cancellation_policy, status: r.status,
});
export const mapBooking = (r: Row): Booking => ({
  id: r.id, listingId: r.listing_id, venueId: r.venue_id, musicianId: r.musician_id, status: r.status,
  cachetArs: Number(r.cachet_ars), note: r.note ?? '', startsAt: r.starts_at, endsAt: r.ends_at,
  cancellationPolicy: r.cancellation_policy, respondBy: r.respond_by, fundBy: r.fund_by ?? null,
  cancelledBy: r.cancelled_by ?? null, cancelReason: r.cancel_reason ?? null, disputedAt: r.disputed_at ?? null,
});
export const mapReview = (r: Row): Review => ({
  id: r.id, bookingId: r.booking_id, authorRole: r.author_role, rating: r.rating, breakdown: r.breakdown ?? {},
  comment: r.comment ?? '', publishedAt: r.published_at ?? null,
});
export const mapMessage = (r: Row): Message => ({ id: r.id, bookingId: r.booking_id, senderRole: r.sender_role, body: r.body, createdAt: r.created_at });

/** Subconjunto del cliente de Supabase que usamos (permite inyectar un falso en los tests). */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
  from(table: string): any;
}

export function createBookingsApi(client: RpcClient) {
  async function call<T>(fn: string, args: Record<string, unknown>, map: (r: Row) => T): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      // Los errores de negocio llegan con el código como mensaje (ej. "musician_busy")
      const code = /^[a-z_]+$/.test(error.message) ? error.message : (error.code ?? 'unknown');
      throw new BookingError(code, errorMessage(code));
    }
    return map(Array.isArray(data) ? data[0] : data);
  }
  async function read<T>(q: PromiseLike<{ data: any; error: { message: string } | null }>, map: (r: Row) => T): Promise<T[]> {
    const { data, error } = await q;
    if (error) throw new BookingError('read_failed', 'No pudimos cargar los datos. Probá de nuevo.');
    return (data ?? []).map(map);
  }
  return {
    // Bar
    createListing: (p: { startsAt: Date; endsAt: Date; cachetArs: number; genres?: string[]; backline?: string[]; notes?: string; bookingMode?: BookingMode; policy?: CancellationPolicy }) =>
      call('create_listing', { p_starts_at: p.startsAt.toISOString(), p_ends_at: p.endsAt.toISOString(), p_cachet_ars: p.cachetArs,
        p_genres: p.genres ?? [], p_backline: p.backline ?? [], p_notes: p.notes ?? '', p_booking_mode: p.bookingMode ?? 'approval', p_policy: p.policy ?? 'moderada' }, mapListing),
    cancelListing: (listingId: string) => call('cancel_listing', { p_listing_id: listingId }, mapListing),
    respond: (bookingId: string, accept: boolean, reason = '') => call('respond_booking', { p_booking_id: bookingId, p_accept: accept, p_reason: reason }, mapBooking),
    fund: (bookingId: string, providerRef?: string) => call('fund_booking', { p_booking_id: bookingId, p_provider_ref: providerRef ?? null }, mapBooking),
    // Músico
    request: (listingId: string, proposedCachetArs?: number, note = '') => call('request_booking', { p_listing_id: listingId, p_proposed_cachet: proposedCachetArs ?? null, p_note: note }, mapBooking),
    // Ambos
    cancel: (bookingId: string, reason = '') => call('cancel_booking', { p_booking_id: bookingId, p_reason: reason }, mapBooking),
    complete: (bookingId: string) => call('complete_booking', { p_booking_id: bookingId }, mapBooking),
    reportProblem: (bookingId: string, reason: string) => call('report_problem', { p_booking_id: bookingId, p_reason: reason }, mapBooking),
    review: (bookingId: string, rating: number, breakdown: Record<string, number>, comment = '') =>
      call('submit_review', { p_booking_id: bookingId, p_rating: rating, p_breakdown: breakdown, p_comment: comment }, mapReview),
    sendMessage: (bookingId: string, body: string) => call('send_message', { p_booking_id: bookingId, p_body: body }, mapMessage),
    // Lecturas (RLS limita cada usuario a lo suyo)
    openListings: () => read(client.from('listings').select('*').eq('status', 'abierta').order('starts_at'), mapListing),
    myBookings: () => read(client.from('bookings').select('*').order('starts_at'), mapBooking),
    messages: (bookingId: string) => read(client.from('messages').select('*').eq('booking_id', bookingId).order('created_at'), mapMessage),
    publishedReviews: (targetId: string) => read(client.from('booking_reviews').select('*').eq('target_id', targetId).not('published_at', 'is', null).order('created_at', { ascending: false }), mapReview),
  };
}

export const bookingsApi = createBookingsApi(supabase as unknown as RpcClient);
