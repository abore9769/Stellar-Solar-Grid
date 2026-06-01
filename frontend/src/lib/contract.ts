import * as StellarSdk from "@stellar/stellar-sdk";
import { useWalletStore } from "@/store/walletStore";

export interface MeterData {
  version: number;
  owner: string;
  active: boolean;
  units_used: bigint;
  plan: string;
  last_payment: bigint;
  expires_at: bigint;
  balance: bigint;
}

export class ContractClient {
  private server: StellarSdk.SorobanRpc.Server;
  private contractId: string;
  private networkPassphrase: string;

  constructor(contractId: string, rpcUrl: string, networkPassphrase: string) {
    this.server = new StellarSdk.SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
  }

  async query(method: string, args: StellarSdk.xdr.ScVal[]): Promise<StellarSdk.xdr.ScVal> {
    const contract = new StellarSdk.Contract(this.contractId);
    const keypair = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(keypair.publicKey(), "0");

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(sim.error);
    }
    const retval = (sim as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!retval) throw new Error(`No result from ${method}`);
    return retval;
  }

  async invoke(sourceAddress: string, method: string, args: StellarSdk.xdr.ScVal[]): Promise<string> {
    const contract = new StellarSdk.Contract(this.contractId);
    const account = await this.server.getAccount(sourceAddress);

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(sim.error);
    }

    tx = StellarSdk.SorobanRpc.assembleTransaction(tx, sim).build();

    const { signTransaction } = useWalletStore.getState();
    const signedXdr = await signTransaction(tx.toXDR());

    const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const result = await this.server.sendTransaction(signedTx);

    if (result.status === "ERROR") {
      throw new Error(`Transaction failed: ${result.errorResult}`);
    }
    return result.hash;
  }
}

export const client = new ContractClient(
  import.meta.env.VITE_CONTRACT_ID,
  import.meta.env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? StellarSdk.Networks.TESTNET,
);

export async function fetchMeter(meterId: string): Promise<MeterData> {
  const meterRetval = await client.query("get_meter", [
    StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
  ]);
  const meterData = StellarSdk.scValToNative(meterRetval);

  const balanceRetval = await client.query("get_meter_balance", [
    StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
  ]);
  const balance = StellarSdk.scValToNative(balanceRetval);

  return { ...meterData, balance: BigInt(balance) } as MeterData;
}

export async function contractInvoke(
  sourceAddress: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
): Promise<string> {
  return client.invoke(sourceAddress, method, args);
}

export async function fetchMetersByOwner(ownerAddress: string): Promise<string[]> {
  const retval = await client.query("get_meters_by_owner", [
    StellarSdk.nativeToScVal(ownerAddress, { type: "address" }),
  ]);
  return StellarSdk.scValToNative(retval) as string[];
}

export async function checkMeterAccess(meterId: string): Promise<boolean> {
  const retval = await client.query("check_access", [
    StellarSdk.nativeToScVal(meterId, { type: "symbol" }),
  ]);
  return StellarSdk.scValToNative(retval) as boolean;
}

export async function fetchAllMeters(): Promise<MeterData[]> {
  const retval = await client.query("get_all_meters", []);
  const rawMeters = StellarSdk.scValToNative(retval) as MeterData[];
  return rawMeters.map((m) => ({ ...m, balance: 0n }));
}
