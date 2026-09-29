import { AppShell } from "./components/AppShell";
import { useRoute } from "./router";
import { ComingSoon } from "./screens/ComingSoon";
import { ExerciseDetail } from "./screens/ExerciseDetail";
import { Home } from "./screens/Home";
import { Library } from "./screens/Library";
import { Practice } from "./screens/Practice";
import { Progress } from "./screens/Progress";
import { RoutineEditor } from "./screens/RoutineEditor";
import { Session } from "./screens/Session";
import { Settings } from "./screens/Settings";
import { Tune } from "./screens/Tune";

export function App() {
  const route = useRoute();

  return (
    <AppShell route={route}>
      {route.name === "home" && <Home />}
      {route.name === "library" && <Library />}
      {route.name === "exercise" && <ExerciseDetail key={route.id} id={route.id} />}
      {route.name === "practice" && <Practice key={route.id} id={route.id} />}
      {route.name === "build" && (
        <ComingSoon
          title="Build an exercise"
          body="Pick scale or arpeggio, root, fret window, strings, pattern, tempo and grading, with a live preview on the neck. Until then, the library's built-ins are ready to go."
        />
      )}
      {route.name === "session" && <Session key={route.source} source={route.source} />}
      {route.name === "routine" && <RoutineEditor key={route.id ?? "new"} id={route.id} />}
      {route.name === "tune" && <Tune />}
      {route.name === "settings" && <Settings />}
      {route.name === "progress" && <Progress />}
    </AppShell>
  );
}
