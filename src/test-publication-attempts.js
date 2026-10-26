// Reservations live only for this service/process lifetime. Reserve before sending,
// including ambiguous failures; restarting deliberately resets duplicate protection.
class TestPublicationAttempts {
  constructor() { this.dates = new Set(); this.events = new Set(); }
  async reserve(date, eventId) {
    if (this.dates.has(date) || this.events.has(eventId)) return false;
    this.dates.add(date);
    this.events.add(eventId);
    return true;
  }
}
module.exports = { TestPublicationAttempts };
