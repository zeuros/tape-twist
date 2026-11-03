import { listRequests } from '../utils/requests'

export default defineEventHandler(async () => {
  const dayAgo = Date.now() - 12 * 3600_000
  return (await listRequests())
    .filter((r) => Date.parse(r.createdAt) > dayAgo)
    .map(({ votes, guestId: _g, ...r }) => ({ ...r, votes: votes.length }))
    .sort((a, b) => (a.status === b.status ? b.votes - a.votes : a.status === 'pending' ? -1 : 1))
})
