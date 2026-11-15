// Answers every host with a public address so tests never reach real DNS.
export const stubLookup = async () => [{ address: '93.184.216.34', family: 4 }];
