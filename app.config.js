// google-services.json isn't in git: EAS builds get it from the GOOGLE_SERVICES_JSON
// secret file variable, local builds use the local file.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
