/** Look up the home's public IP at start-up, so the first Funnel visitor isn't kept waiting. */
export default defineNitroPlugin(() => {
  void homePublicIp()
})
