import { TixBitClient } from "tixbit";

const client = new TixBitClient({ baseUrl: "https://www.tixbit.com" });
const { events } = await client.searchEvents({
  query: "Braves", city: "Atlanta", state: "GA", size: 5,
});
const event = events[0];
if (!event) throw new Error("No matching event. Ask for broader search criteria.");

const { listings } = await client.getListings({
  eventId: event.external_event_id, size: 10,
});
const quantity = 2;
const listing = listings.find((item) => item.quantities_list.includes(quantity));
if (!listing) throw new Error("No returned listing permits the requested quantity.");

// This is a preview URL. Let the user choose their listing before handing off.
const checkout = client.createCheckoutLink({ listingId: listing.id, quantity });
console.log(JSON.stringify({
  event: { id: event.external_event_id, name: event.name, date: event.date },
  listing: { id: listing.id, section: listing.section, row: listing.row },
  checkoutUrl: checkout.url,
}, null, 2));
// The user reviews the final total and completes payment on TixBit.
