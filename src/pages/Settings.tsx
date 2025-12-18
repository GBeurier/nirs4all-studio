import { motion } from "framer-motion";
import { FolderOpen, Monitor, Sun, Moon, Palette, RefreshCw } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { selectFolder } from "@/utils/fileDialogs";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Settings() {
  const { theme, setTheme } = useTheme();

  const handleSelectWorkspace = async () => {
    const path = await selectFolder();
    if (path) {
      console.log("Selected workspace:", path);
      // TODO: Call API to set workspace
    }
  };

  return (
    <motion.div
      className="space-y-6 max-w-3xl"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your workspace and application preferences
        </p>
      </motion.div>

      {/* Workspace Settings */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Workspace
            </CardTitle>
            <CardDescription>
              Set the workspace folder for storing pipelines, results, and predictions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                placeholder="No workspace selected"
                readOnly
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectWorkspace}>
                <FolderOpen className="mr-2 h-4 w-4" />
                Browse
              </Button>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">Status</Badge>
              <span>No workspace configured</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Appearance Settings */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Appearance
            </CardTitle>
            <CardDescription>
              Customize the look and feel of the application
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-3 block">Theme</label>
              <div className="flex gap-2">
                <Button
                  variant={theme === "light" ? "default" : "outline"}
                  onClick={() => setTheme("light")}
                  className="flex-1"
                >
                  <Sun className="mr-2 h-4 w-4" />
                  Light
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "outline"}
                  onClick={() => setTheme("dark")}
                  className="flex-1"
                >
                  <Moon className="mr-2 h-4 w-4" />
                  Dark
                </Button>
                <Button
                  variant={theme === "system" ? "default" : "outline"}
                  onClick={() => setTheme("system")}
                  className="flex-1"
                >
                  <Monitor className="mr-2 h-4 w-4" />
                  System
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Advanced Settings */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Advanced
            </CardTitle>
            <CardDescription>
              Development and troubleshooting options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Backend URL</p>
                <p className="text-xs text-muted-foreground">
                  API endpoint (development only)
                </p>
              </div>
              <Input
                defaultValue="http://127.0.0.1:8000"
                className="w-64"
                disabled
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Clear Cache</p>
                <p className="text-xs text-muted-foreground">
                  Reset local storage and cached data
                </p>
              </div>
              <Button variant="outline" size="sm">
                Clear Cache
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Reset to Defaults</p>
                <p className="text-xs text-muted-foreground">
                  Restore all settings to their default values
                </p>
              </div>
              <Button variant="outline" size="sm" className="text-destructive">
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* App Info */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>nirs4all webapp v1.0.0</span>
            <span>© 2025 nirs4all</span>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
