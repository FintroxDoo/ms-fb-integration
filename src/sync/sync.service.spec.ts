import { SyncService } from './sync.service';
import { FbClient, FbInvoice } from '../freshbooks/freshbooks.types';

const CLIENTS_PAGE_KEY = 'backfill.clients.page';
const INVOICES_PAGE_KEY = 'backfill.invoices.page';

type PageHandler<T> = (items: T[], page: number) => Promise<void>;

function client(id: number): FbClient {
  return {
    userid: id,
    vis_state: 0,
    fname: 'First',
    lname: `Last${id}`,
    email: `client${id}@example.com`,
  } as unknown as FbClient;
}

function invoice(id: number, customerId: number): FbInvoice {
  return {
    invoiceid: id,
    customerid: customerId,
    vis_state: 0,
    amount: { amount: '10.00' },
    lines: [],
    create_date: '2024-01-01',
    due_date: '2024-02-01',
    invoice_number: `INV-${id}`,
    currency_code: 'USD',
  } as unknown as FbInvoice;
}

function makeService() {
  const fb = {
    listClientsEach: jest.fn(),
    listInvoicesEach: jest.fn(),
  };
  const upflow = {
    upsertCustomer: jest.fn().mockResolvedValue({ id: 'up-cust' }),
    upsertInvoice: jest.fn().mockResolvedValue({ id: 'up-inv' }),
  };
  const prisma = {
    customerSync: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    invoiceSync: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    syncCursor: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  };
  const config = { get: jest.fn().mockReturnValue({ concurrency: 5 }) };

  const service = new SyncService(
    fb as never,
    upflow as never,
    prisma as never,
    config as never,
  );
  return { service, fb, upflow, prisma };
}

describe('SyncService.backfill (streaming + resumable)', () => {
  it('streams every page and pushes all active rows', async () => {
    const { service, fb, upflow, prisma } = makeService();
    fb.listClientsEach.mockImplementation(
      async (onPage: PageHandler<FbClient>) => {
        await onPage([client(1), client(2)], 1);
        await onPage([client(3)], 2);
      },
    );
    fb.listInvoicesEach.mockImplementation(
      async (onPage: PageHandler<FbInvoice>) => {
        await onPage([invoice(10, 1)], 1);
      },
    );

    const result = await service.backfill();

    expect(upflow.upsertCustomer).toHaveBeenCalledTimes(3);
    expect(upflow.upsertInvoice).toHaveBeenCalledTimes(1);
    expect(result.customers).toEqual({ ok: 3, failed: 0 });
    expect(result.invoices).toEqual({ ok: 1, failed: 0 });

    // Final updated_min cursor set; page checkpoints cleared on completion.
    expect(prisma.syncCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'invoices.updated_min' } }),
    );
    expect(prisma.syncCursor.delete).toHaveBeenCalledWith({
      where: { key: CLIENTS_PAGE_KEY },
    });
    expect(prisma.syncCursor.delete).toHaveBeenCalledWith({
      where: { key: INVOICES_PAGE_KEY },
    });
  });

  it('skips rows already synced ok (resume)', async () => {
    const { service, fb, upflow, prisma } = makeService();
    prisma.customerSync.findMany.mockResolvedValue([
      { fbClientId: 'fb_client_1' },
    ]);
    fb.listClientsEach.mockImplementation(
      async (onPage: PageHandler<FbClient>) => {
        await onPage([client(1), client(2)], 1);
      },
    );
    fb.listInvoicesEach.mockImplementation(async () => undefined);

    const result = await service.backfill();

    const pushedIds = upflow.upsertCustomer.mock.calls
      .map((c) => (c[0] as { externalId: string }).externalId)
      .sort();
    expect(pushedIds).toEqual(['fb_client_2']); // client 1 skipped
    expect(result.customers).toEqual({ ok: 1, failed: 0 });
  });

  it('resumes streaming from the saved page checkpoint', async () => {
    const { service, fb, prisma } = makeService();
    prisma.syncCursor.findUnique.mockImplementation(
      async ({ where: { key } }: { where: { key: string } }) =>
        key === CLIENTS_PAGE_KEY ? { value: '7' } : null,
    );
    fb.listClientsEach.mockImplementation(async () => undefined);
    fb.listInvoicesEach.mockImplementation(async () => undefined);

    await service.backfill();

    expect(fb.listClientsEach).toHaveBeenCalledWith(expect.any(Function), {
      startPage: 7,
    });
    expect(fb.listInvoicesEach).toHaveBeenCalledWith(expect.any(Function), {
      startPage: undefined,
    });
  });

  it('advances the page checkpoint after each page', async () => {
    const { service, fb, prisma } = makeService();
    fb.listClientsEach.mockImplementation(
      async (onPage: PageHandler<FbClient>) => {
        await onPage([client(1)], 1);
        await onPage([client(2)], 2);
      },
    );
    fb.listInvoicesEach.mockImplementation(async () => undefined);

    await service.backfill();

    expect(prisma.syncCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CLIENTS_PAGE_KEY },
        update: { value: '2' },
      }),
    );
    expect(prisma.syncCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: CLIENTS_PAGE_KEY },
        update: { value: '3' },
      }),
    );
  });
});
