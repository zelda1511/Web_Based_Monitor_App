// Stops a "signed" build that would silently come out unsigned.
// electron-builder signs when CSC_LINK (a .pfx path, or base64 of one) and CSC_KEY_PASSWORD are set.
// Azure Trusted Signing is the alternative: see CLAUDE.md "Signing".
if (!process.env.CSC_LINK && !process.env.AZURE_TENANT_ID) {
  console.error(
    'No certificate: set CSC_LINK (path to your .pfx) and CSC_KEY_PASSWORD, then run again.\n' +
      'Without one the exe is unsigned and Smart App Control blocks it.',
  );
  process.exit(1);
}
