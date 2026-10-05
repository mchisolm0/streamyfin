import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import type { makeApi } from "@/test-utils/jellyfinApi";
import { clearMmkv } from "@/test-utils/mmkv";
import { storage } from "@/utils/mmkv";
import { MusicPlayerProvider, useMusicPlayer } from "./MusicPlayerProvider";

/** The socket's subscribers, by message type. */
const mockHandlers = new Map<string, (data: unknown) => void>();

jest.mock(
  "react-native-mmkv",
  () => jest.requireActual("@/test-utils/mmkv").mmkvModule,
);
// The native audio player: every call succeeds and nothing plays. Virtual,
// because the package ships from git without the build its `main` points at,
// which only Metro knows how to step around.
jest.mock(
  "react-native-track-player",
  () => ({
    __esModule: true,
    default: new Proxy({}, { get: () => async () => undefined }),
    Capability: {},
    RepeatMode: {},
  }),
  { virtual: true },
);
jest.mock("@/providers/AudioStorage", () => ({
  initAudioStorage: async () => {},
  getLocalPath: () => null,
  isDownloading: () => false,
  setMaxCacheSizeMB: () => {},
  downloadTrack: async () => {},
}));
jest.mock("@/providers/JellyfinProvider", () => {
  const { atom } = jest.requireActual("jotai");
  const { makeApi: make } = jest.requireActual("@/test-utils/jellyfinApi");
  const mockApi = make();
  return {
    apiAtom: atom(mockApi),
    userAtom: atom({ Id: "user-1", ServerId: "server-1" }),
    mockApi,
  };
});
jest.mock("@/providers/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ isConnected: true, serverConnected: true }),
}));
jest.mock("@/providers/WebSocketProvider", () => ({
  useWebSocketContext: () => ({
    subscribe: (type: string, handler: (data: unknown) => void) => {
      mockHandlers.set(type, handler);
      return () => mockHandlers.delete(type);
    },
  }),
}));
jest.mock("@/utils/atoms/settings", () => ({
  settingsAtom: jest.requireActual("jotai").atom({}),
}));
jest.mock("@/utils/customHeaders", () =>
  jest.requireActual("@/test-utils/customHeaders").customHeadersModule(),
);
jest.mock("@/utils/log", () => ({ logAndCaptureError: jest.fn() }));
jest.mock("@/utils/jellyfin/audio/getAudioStreamUrl", () => ({
  getAudioStreamUrl: async (_api: unknown, _user: string, id: string) => ({
    url: `https://jellyfin.example.com/Audio/${id}/stream`,
    sessionId: `play-${id}`,
    mediaSource: null,
    isTranscoding: false,
  }),
}));

const api: ReturnType<typeof makeApi> = jest.requireMock(
  "@/providers/JellyfinProvider",
).mockApi;

const START_URL = "https://jellyfin.example.com/Sessions/Playing";
const PROGRESS_URL = "https://jellyfin.example.com/Sessions/Playing/Progress";

const TRACK: BaseItemDto = {
  Id: "track-1",
  Name: "Track",
  ServerId: "server-1",
};

let player: ReturnType<typeof useMusicPlayer>;
const Probe = () => {
  player = useMusicPlayer();
  return (
    <Text>{`${player.repeatMode} ${player.shuffleEnabled ? "shuffled" : "sorted"}`}</Text>
  );
};

const reports = (url: string) =>
  api.mock.history.post
    .filter((request) => request.url === url)
    .map((request) => JSON.parse(request.data));

/** A remote control's command, as the socket delivers it. */
const receive = (Name: string, Arguments: Record<string, string>) =>
  act(async () => mockHandlers.get("GeneralCommand")?.({ Name, Arguments }));

/** Lets a request that was on its way reach the server double. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const mount = () =>
  render(
    <MusicPlayerProvider>
      <Probe />
    </MusicPlayerProvider>,
  );

/** Mounts the player with one track playing and its start reported. */
const startPlaying = async () => {
  await mount();
  await act(async () => player.playQueue([TRACK]));
  await waitFor(() => expect(reports(START_URL)).toHaveLength(1));
};

describe("MusicPlayerProvider repeat and shuffle", () => {
  beforeEach(() => {
    clearMmkv();
    mockHandlers.clear();
    api.mock.reset();
    api.mock.onPost().reply(204);
  });

  test("the playback start report carries the saved modes", async () => {
    storage.set("music_player_repeat_mode", "all");
    storage.set("music_player_shuffle_enabled", true);

    await startPlaying();

    expect(reports(START_URL)[0]).toMatchObject({
      ItemId: "track-1",
      RepeatMode: "RepeatAll",
      PlaybackOrder: "Shuffle",
    });
  });

  // The heartbeat is 10 s apart. A remote control that had to wait for it
  // would show the old mode long after its own command was obeyed.
  test("a remote repeat command is applied and reported at once", async () => {
    await startPlaying();

    await receive("SetRepeatMode", { RepeatMode: "RepeatOne" });

    expect(screen.getByText("one sorted")).toBeTruthy();
    await waitFor(() =>
      expect(reports(PROGRESS_URL)).toEqual([
        expect.objectContaining({
          ItemId: "track-1",
          RepeatMode: "RepeatOne",
          PlaybackOrder: "Default",
        }),
      ]),
    );
    // The app's own repeat button reads the same setting on the next launch.
    expect(storage.getString("music_player_repeat_mode")).toBe("one");
  });

  test("a remote shuffle command is applied and reported at once", async () => {
    await startPlaying();

    await receive("SetShuffleQueue", { ShuffleMode: "Shuffle" });

    expect(screen.getByText("off shuffled")).toBeTruthy();
    await waitFor(() =>
      expect(reports(PROGRESS_URL)).toEqual([
        expect.objectContaining({ PlaybackOrder: "Shuffle" }),
      ]),
    );

    await receive("SetShuffleQueue", { ShuffleMode: "Sorted" });

    expect(screen.getByText("off sorted")).toBeTruthy();
    await waitFor(() =>
      expect(reports(PROGRESS_URL)[1]).toMatchObject({
        PlaybackOrder: "Default",
      }),
    );
  });

  // The command names a mode, it does not toggle: a remote that sends the
  // mode already in effect must not flip it, or reshuffle the queue.
  test("a command for the mode already in effect changes nothing", async () => {
    storage.set("music_player_shuffle_enabled", true);
    await startPlaying();

    await receive("SetShuffleQueue", { ShuffleMode: "Shuffle" });
    expect(screen.getByText("off shuffled")).toBeTruthy();

    // The next real change is the first thing the server hears about.
    await receive("SetShuffleQueue", { ShuffleMode: "Sorted" });
    await waitFor(() => expect(reports(PROGRESS_URL)).not.toEqual([]));
    expect(reports(PROGRESS_URL)).toEqual([
      expect.objectContaining({ PlaybackOrder: "Default" }),
    ]);
  });

  test("the app's own shuffle and repeat buttons report at once too", async () => {
    await startPlaying();

    await act(async () => player.toggleShuffle());
    await act(async () => player.setRepeatMode("all"));

    await waitFor(() =>
      expect(reports(PROGRESS_URL)).toEqual([
        expect.objectContaining({ PlaybackOrder: "Shuffle" }),
        expect.objectContaining({
          PlaybackOrder: "Shuffle",
          RepeatMode: "RepeatAll",
        }),
      ]),
    );
  });

  // The engine offers a heartbeat every 10 s of playback and the provider
  // drops one that follows another too closely. A mode report is not a
  // heartbeat: counting it would cost the next real one.
  test("a mode report does not hold back the next heartbeat", async () => {
    await startPlaying();
    await receive("SetRepeatMode", { RepeatMode: "RepeatAll" });
    await waitFor(() => expect(reports(PROGRESS_URL)).toHaveLength(1));

    await act(async () => player.reportProgress());

    await waitFor(() => expect(reports(PROGRESS_URL)).toHaveLength(2));
  });

  // The session is the whole app's: the command also arrives while a video
  // plays, or with nothing playing at all. Neither is the music player's to
  // act on, and a progress report from it would invent a playing session.
  test("a command is left alone while no music is playing", async () => {
    await mount();

    await receive("SetRepeatMode", { RepeatMode: "RepeatAll" });
    await receive("SetShuffleQueue", { ShuffleMode: "Shuffle" });
    await settle();

    expect(screen.getByText("off sorted")).toBeTruthy();
    expect(api.mock.history.post).toEqual([]);
  });

  test("changing a mode with nothing playing reports nothing", async () => {
    await mount();

    await act(async () => player.setRepeatMode("one"));
    await settle();

    expect(screen.getByText("one sorted")).toBeTruthy();
    expect(api.mock.history.post).toEqual([]);
  });
});
