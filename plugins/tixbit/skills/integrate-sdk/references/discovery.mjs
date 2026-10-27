import { TixBitClient } from "tixbit";

const client = new TixBitClient({ baseUrl: "https://www.tixbit.com" });
const { events } = await client.searchEvents({
  query: "Braves", city: "Atlanta", state: "GA", size: 5,
});
// Search can include add-ons (for example season parking) and events without listings.
const candidates = events.filter((item) => item.has_listings);
if (candidates.length === 0) throw new Error("No matching event with listings. Ask for broader search criteria.");

const quantity = 2;
let event;
let listing;
for (const candidate of candidates) {
  const { listings } = await client.getListings({
    eventId: candidate.external_event_id, size: 10,
  });
  listing = listings.find((item) => item.quantities_list.includes(quantity));
  if (listing) { event = candidate; break; }
}
if (!event || !listing) throw new Error("No returned listing permits the requested quantity.");

// This is a preview URL. Let the user choose their listing before handing off.
const checkout = client.createCheckoutLink({ listingId: listing.id, quantity });
console.log(JSON.stringify({
  event: { id: event.external_event_id, name: event.name, date: event.date },
  listing: { id: listing.id, section: listing.section, row: listing.row },
  checkoutUrl: checkout.url,
}, null, 2));
// The user reviews the final total and completes payment on TixBit.
