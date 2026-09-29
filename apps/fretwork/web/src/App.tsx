import { AppShell } from "./components/AppShell";
import { useRoute } from "./router";
import { Builder } from "./screens/Builder";
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
      {route.name === "build" && <Builder key={`${route.mode}:${route.id}`} mode={route.mode} id={route.id} />}
      {route.name === "session" && <Session key={route.source} source={route.source} />}
      {route.name === "routine" && <RoutineEditor key={route.id ?? "new"} id={route.id} />}
      {route.name === "tune" && <Tune />}
      {route.name === "settings" && <Settings />}
      {route.name === "progress" && <Progress />}
    </AppShell>
  );
}
