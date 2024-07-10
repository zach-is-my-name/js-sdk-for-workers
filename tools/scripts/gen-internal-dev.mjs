import { ethers } from 'ethers';
import fs from 'fs/promises';
import path from 'path';

const API =
  'https://lit-general-worker.getlit.dev/internal-dev-contract-addresses';

function removeKickedValidators(activeValidators, kickedValidators) {
  return activeValidators.filter(
    (av) => !kickedValidators.some((kv) => kv.nodeAddress === av.nodeAddress)
  );
}

const getValidators = async () => {
  let data;
  try {
    // Fetch and parse the JSON data in one step
    data = await fetch(API).then((res) => res.json());
  } catch (e) {
    throw new Error(`Error fetching data from ${API}: ${e.toString()}`);
  }

  // Destructure the data for easier access
  const { config, data: contractData } = data;
  const stakingContract = contractData.find((item) => item.name === 'Staking')
    .contracts[0];
  const { address_hash: address, ABI: abi } = stakingContract;

  // Validate the required data
  if (!config || !address || !abi) {
    throw new Error('❌ Required contract data is missing');
  }

  // Initialize contract
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const contract = new ethers.Contract(address, abi, provider);

  // Fetch contract data
  const configs = await contract.config();
  const minNodeCount = configs.minimumValidatorCount.toString();

  // Fetch validators data in parallel
  const [activeValidators, currentValidatorsCount, kickedValidators] =
    await Promise.all([
      contract.getValidatorsStructsInCurrentEpoch(),
      contract.currentValidatorCountForConsensus(),
      contract.getKickedValidators(),
    ]);

  const validators = [];

  // Check if active validator set meets the threshold
  if (
    activeValidators.length - kickedValidators.length >=
    currentValidatorsCount
  ) {
    // Process each validator
    for (const validator of activeValidators) {
      validators.push(validator);
    }
  } else {
    console.log('❌ Active validator set does not meet the threshold');
  }

  const cleanedActiveValidators = removeKickedValidators(
    activeValidators,
    kickedValidators
  );

  return { minNodeCount, validators: cleanedActiveValidators };
};

const intToIP = (ip) => {
  // -- ip
  // Convert integer to binary string and pad with leading zeros to make it 32-bit
  const binaryString = ip.toString(2).padStart(32, '0');
  // Split into octets and convert each one to decimal
  const ipArray = [];
  for (let i = 0; i < 32; i += 8) {
    ipArray.push(parseInt(binaryString.substring(i, i + 8), 2));
  }
  // Join the octets with dots to form the IP address
  return ipArray.join('.');
};

try {
  const { validators, minNodeCount } = await getValidators();

  const networks = validators.map((item) => {
    let proto = 'https://';
    if (item.port !== 443) {
      proto = 'http://';
    }
    return `${proto}${intToIP(item.ip)}:${item.port}`;
  });

  console.log('✅ networks', networks);

  const internalPath =
    './packages/constants/src/lib/constants/autogen_internal.ts';

  const date = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');

  await fs.writeFile(
    internalPath,
    `// This file is auto-generated by tools/scripts/gen-internal-dev.mjs
export const INTERNAL_DEV = ${JSON.stringify(networks, null, 2)};

export const INTERNAL_MIN_NODE_COUNT = ${minNodeCount};

export const INTERNAL_DEFAULT_CONFIG = {
  alertWhenUnauthorized: false,
  minNodeCount: ${minNodeCount},
  debug: true,
  bootstrapUrls: ${content},
  litNetwork: 'internalDev',
  connectTimeout: 20000,
};`
  );
} catch (e) {
  console.log(`❗️ Skipping... Failed to generate internal-dev.ts file: ${e}.`);
  console.log(e);
}
