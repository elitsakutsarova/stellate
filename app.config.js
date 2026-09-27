// Everything else lives in app.json - this only adds where the Firebase config
// file (google-services.json) is. The file isn't in git, since it holds an
// API key: on EAS's build servers it comes from the GOOGLE_SERVICES_JSON
// secret file variable, and on this laptop it's the local file.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
});
