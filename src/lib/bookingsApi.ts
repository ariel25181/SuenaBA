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

export interface SearchFilters {
  from?: string; to?: string; neighborhoods?: string[]; genres?: string[]; minCachet?: number; maxCachet?: number;
  mode?: BookingMode; minRating?: number; text?: string; hideBusy?: boolean; sort?: 'date' | 'cachet_desc' | 'rating_desc'; limit?: number; offset?: number;
}
export interface SearchResult extends Listing {
  venueName: string; neighborhood: string; address: string; coverPhoto: string | null; capacity: number;
  venueRating: number; venueReviewCount: number; venueSuperhost: boolean; totalCount: number;
}
export interface AppNotification { id: string; kind: string; bookingId: string | null; listingId: string | null; title: string; body: string; createdAt: string; readAt: string | null }
export interface SavedSearch { id: string; name: string; filters: Record<string, unknown>; createdAt: string }
export interface Earnings { role: 'bar' | 'musico'; pendingArs: number; settledArs: number; refundedArs: number; showsCompleted: number }
export interface EntityStats { completed: number; cancelledAfterConfirm: number; cancelRate: number; responseRate: number | null; avgResponseHours: number | null; rating: number; reviewCount: number; isSuperhost: boolean }
export interface Profile { userId: string; role: 'bar' | 'musico'; venueId: string | null; musicianId: string | null; verified: boolean; lateCancellations: number }
export interface ProfileRequest { id: string; role: 'bar' | 'musico'; displayName: string; status: 'pendiente' | 'aprobada' | 'rechazada'; reviewerNote: string | null; createdAt: string }
export interface BookingEvent { id: number; event: string; fromStatus: string | null; toStatus: string | null; at: string; meta: Record<string, unknown> }
export interface PaymentInfo { status: 'held' | 'released' | 'refunded' | 'partially_refunded'; chargedArs: number; cachetArs: number; venueFeeArs: number; refundedArs: number; payoutArs: number; platformFeeArs: number; provider: string }
export interface EntityLite { id: string; name: string; photo: string | null; subtitle: string }
export interface Fees { venueFeeBps: number; musicianFeeBps: number }

export interface NotifPrefs { emailEnabled: boolean; pushEnabled: boolean; mutedKinds: string[] }
export interface UserPrefs { audience: 'anfitrion' | 'musico' | 'publico' | null; tourVersion: number; whatsNewSeen: number }
export interface PublicShow { bookingId: string; venueId: string; venueName: string; neighborhood: string; address: string; coverPhoto: string | null; musicianName: string; musicianFormat: string; genres: string[]; startsAt: string; endsAt: string; totalCount: number }
export interface ShowFilters { neighborhoods?: string[]; genres?: string[]; from?: string; to?: string; limit?: number; offset?: number }

const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));

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
export const mapSearchResult = (r: Row): SearchResult => ({
  id: r.listing_id, venueId: r.venue_id, startsAt: r.starts_at, endsAt: r.ends_at, cachetArs: num(r.cachet_ars), genres: r.genres ?? [], backline: r.backline ?? [],
  notes: r.notes ?? '', bookingMode: r.booking_mode, cancellationPolicy: r.cancellation_policy, status: 'abierta',
  venueName: r.venue_name, neighborhood: r.neighborhood, address: r.address, coverPhoto: r.cover_photo ?? null, capacity: num(r.capacity),
  venueRating: num(r.venue_rating), venueReviewCount: num(r.venue_review_count), venueSuperhost: !!r.venue_superhost, totalCount: num(r.total_count),
});
export const mapNotification = (r: Row): AppNotification => ({ id: r.id, kind: r.kind, bookingId: r.booking_id ?? null, listingId: r.listing_id ?? null, title: r.title, body: r.body ?? '', createdAt: r.created_at, readAt: r.read_at ?? null });
export const mapSavedSearch = (r: Row): SavedSearch => ({ id: r.id, name: r.name, filters: r.filters ?? {}, createdAt: r.created_at });
export const mapEarnings = (r: Row): Earnings => ({ role: r.role, pendingArs: num(r.pending_ars), settledArs: num(r.settled_ars), refundedArs: num(r.refunded_ars), showsCompleted: num(r.shows_completed) });
export const mapStats = (r: Row): EntityStats => ({
  completed: num(r.completed), cancelledAfterConfirm: num(r.cancelled_after_confirm), cancelRate: num(r.cancel_rate),
  responseRate: r.response_rate === null || r.response_rate === undefined ? null : Number(r.response_rate),
  avgResponseHours: r.avg_response_hours === null || r.avg_response_hours === undefined ? null : Number(r.avg_response_hours),
  rating: num(r.rating), reviewCount: num(r.review_count), isSuperhost: !!r.is_superhost,
});
export const mapProfile = (r: Row): Profile => ({ userId: r.user_id, role: r.role, venueId: r.venue_id ?? null, musicianId: r.musician_id ?? null, verified: !!r.verified, lateCancellations: num(r.late_cancellations) });
export const mapProfileRequest = (r: Row): ProfileRequest => ({ id: r.id, role: r.role, displayName: r.display_name, status: r.status, reviewerNote: r.reviewer_note ?? null, createdAt: r.created_at });
export const mapEvent = (r: Row): BookingEvent => ({ id: Number(r.id), event: r.event, fromStatus: r.from_status ?? null, toStatus: r.to_status ?? null, at: r.at, meta: r.meta ?? {} });
export const mapPayment = (r: Row): PaymentInfo => ({ status: r.status, chargedArs: num(r.charged_ars), cachetArs: num(r.cachet_ars), venueFeeArs: num(r.venue_fee_ars), refundedArs: num(r.refunded_ars), payoutArs: num(r.payout_ars), platformFeeArs: num(r.platform_fee_ars), provider: r.provider });

export const mapNotifPrefs = (r: Row): NotifPrefs => ({ emailEnabled: r.email_enabled !== false, pushEnabled: r.push_enabled !== false, mutedKinds: r.muted_kinds ?? [] });
export const mapPrefs = (r: Row): UserPrefs => ({ audience: r.audience ?? null, tourVersion: num(r.tour_version), whatsNewSeen: num(r.whats_new_seen) });
export const mapShow = (r: Row): PublicShow => ({ bookingId: r.booking_id, venueId: r.venue_id, venueName: r.venue_name, neighborhood: r.neighborhood, address: r.address ?? '', coverPhoto: r.cover_photo ?? null,
  musicianName: r.musician_name, musicianFormat: r.musician_format, genres: r.genres ?? [], startsAt: r.starts_at, endsAt: r.ends_at, totalCount: num(r.total_count) });

export const mapMessage = (r: Row): Message => ({ id: r.id, bookingId: r.booking_id, senderRole: r.sender_role, body: r.body, createdAt: r.created_at });

/** Subconjunto del cliente de Supabase que usamos (permite inyectar un falso en los tests). */
export interface AuthClient {
  getSession(): Promise<{ data: { session: { user: { id: string; email?: string } } | null } }>;
  onAuthStateChange(cb: (event: string, session: { user: { id: string; email?: string } } | null) => void): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(c: { email: string; password: string }): Promise<{ error: { message: string } | null }>;
  signUp(c: { email: string; password: string }): Promise<{ error: { message: string } | null; data?: { session: unknown | null } }>;
  signOut(): Promise<unknown>;
}
export interface AppClient extends RpcClient { auth: AuthClient }
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
  const callRows = async <T,>(fn: string, args: Record<string, unknown>, map: (r: Row) => T): Promise<T[]> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) { const code = /^[a-z_]+$/.test(error.message) ? error.message : (error.code ?? 'unknown'); throw new BookingError(code, errorMessage(code)); }
    return (Array.isArray(data) ? data : data ? [data] : []).map(map);
  };
  const callScalar = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) { const code = /^[a-z_]+$/.test(error.message) ? error.message : (error.code ?? 'unknown'); throw new BookingError(code, errorMessage(code)); }
    return data as T;
  };
  return {
    // Descubrimiento
    search: (f: SearchFilters = {}) => callRows('search_listings', {
      p_from: f.from ?? null, p_to: f.to ?? null, p_neighborhoods: f.neighborhoods?.length ? f.neighborhoods : null, p_genres: f.genres?.length ? f.genres : null,
      p_min_cachet: f.minCachet ?? null, p_max_cachet: f.maxCachet ?? null, p_mode: f.mode ?? null, p_min_rating: f.minRating ?? null,
      p_text: f.text?.trim() ? f.text.trim() : null, p_hide_busy: f.hideBusy ?? false, p_sort: f.sort ?? 'date', p_limit: f.limit ?? 20, p_offset: f.offset ?? 0 }, mapSearchResult),
    stats: async (kind: 'venue' | 'musician', id: string) => (await callRows('entity_stats', { p_kind: kind, p_id: id }, mapStats))[0] ?? null,
    toggleFavorite: (kind: 'listing' | 'venue' | 'musician', targetId: string) => callScalar<boolean>('toggle_favorite', { p_kind: kind, p_target_id: targetId }),
    favorites: () => read(client.from('favorites').select('*').order('created_at', { ascending: false }), (r) => ({ kind: r.kind as 'listing' | 'venue' | 'musician', targetId: r.target_id as string })),
    saveSearch: (name: string, filters: Record<string, unknown>) => call('save_search', { p_name: name, p_filters: filters }, mapSavedSearch),
    savedSearches: () => read(client.from('saved_searches').select('*').order('created_at', { ascending: false }), mapSavedSearch),
    deleteSearch: (id: string) => callScalar<boolean>('delete_saved_search', { p_id: id }),
    // Notificaciones
    notifications: (limit = 50) => read(client.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit), mapNotification),
    markRead: (ids?: string[]) => callScalar<number>('mark_notifications_read', { p_ids: ids ?? null }),
    // Cuenta
    earnings: async () => (await callRows('my_earnings', {}, mapEarnings))[0],
    fees: async (): Promise<Fees> => { const [r] = await read(client.from('app_settings').select('venue_fee_bps,musician_fee_bps'), (x) => ({ venueFeeBps: num(x.venue_fee_bps), musicianFeeBps: num(x.musician_fee_bps) })); return r ?? { venueFeeBps: 0, musicianFeeBps: 0 }; },
    myProfile: async () => (await read(client.from('profiles').select('*'), mapProfile))[0] ?? null,
    myProfileRequest: async () => (await read(client.from('profile_requests').select('*').order('created_at', { ascending: false }).limit(1), mapProfileRequest))[0] ?? null,
    requestProfile: (p: { role: 'bar' | 'musico'; displayName: string; neighborhood?: string; address?: string; bio?: string; evidenceUrl?: string }) =>
      call('request_profile', { p_role: p.role, p_display_name: p.displayName, p_neighborhood: p.neighborhood || null, p_address: p.address || null, p_bio: p.bio ?? '', p_evidence_url: p.evidenceUrl || null }, mapProfileRequest),
    // Preferencias, tour y cartelera pública
    getPrefs: async () => (await read(client.from('user_prefs').select('*'), mapPrefs))[0] ?? null,
    savePrefs: async (p: { audience?: UserPrefs['audience']; tourVersion?: number; whatsNewSeen?: number }) =>
      (await callRows('save_user_prefs', { p_audience: p.audience ?? null, p_tour_version: p.tourVersion ?? null, p_whats_new_seen: p.whatsNewSeen ?? null }, mapPrefs))[0],
    upcomingShows: (f: ShowFilters = {}) => callRows('upcoming_shows', { p_from: f.from ?? null, p_to: f.to ?? null, p_neighborhoods: f.neighborhoods?.length ? f.neighborhoods : null,
      p_genres: f.genres?.length ? f.genres : null, p_limit: f.limit ?? 20, p_offset: f.offset ?? 0 }, mapShow),
    // Avisos por email y push
    notificationPrefs: async (): Promise<NotifPrefs> => (await read(client.from('notification_prefs').select('*'), mapNotifPrefs))[0] ?? { emailEnabled: true, pushEnabled: true, mutedKinds: [] },
    setNotificationPrefs: async (p: { email?: boolean; push?: boolean; mutedKinds?: string[] }) =>
      (await callRows('set_notification_prefs', { p_email: p.email ?? null, p_push: p.push ?? null, p_muted_kinds: p.mutedKinds ?? null }, mapNotifPrefs))[0],
    registerPush: (s: { endpoint: string; p256dh: string; auth: string; userAgent?: string }) => callScalar<string>('register_push_subscription', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth, p_user_agent: s.userAgent ?? null }),
    removePush: (endpoint: string) => callScalar<boolean>('remove_push_subscription', { p_endpoint: endpoint }),
    // Detalle de reservas
    booking: async (id: string) => (await read(client.from('bookings').select('*').eq('id', id), mapBooking))[0] ?? null,
    bookingEvents: (bookingId: string) => read(client.from('booking_events').select('*').eq('booking_id', bookingId).order('id', { ascending: true }), mapEvent),
    bookingPayment: async (bookingId: string) => (await read(client.from('payments').select('*').eq('booking_id', bookingId), mapPayment))[0] ?? null,
    bookingReviews: (bookingId: string) => read(client.from('booking_reviews').select('*').eq('booking_id', bookingId), mapReview),
    myListings: (venueId: string) => read(client.from('listings').select('*').eq('venue_id', venueId).neq('status', 'cancelada').order('starts_at'), mapListing),
    listingsByIds: (ids: string[]) => ids.length ? read(client.from('listings').select('*').in('id', ids), mapListing) : Promise.resolve([] as Listing[]),
    venues: (ids: string[]) => ids.length ? read(client.from('venues').select('id,name,cover_photo,neighborhood').in('id', ids), (r): EntityLite => ({ id: r.id, name: r.name, photo: r.cover_photo ?? null, subtitle: r.neighborhood })) : Promise.resolve([] as EntityLite[]),
    musicians: (ids: string[]) => ids.length ? read(client.from('musicians').select('id,stage_name,avatar_url,format').in('id', ids), (r): EntityLite => ({ id: r.id, name: r.stage_name, photo: r.avatar_url ?? null, subtitle: r.format })) : Promise.resolve([] as EntityLite[]),
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
