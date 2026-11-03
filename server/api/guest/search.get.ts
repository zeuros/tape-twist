import { searchFavorites } from '../../utils/requests'

export default defineEventHandler((event) => searchFavorites(String(getQuery(event).q ?? '').slice(0, 100)))
