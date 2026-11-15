import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject

plugins {
  alias(libs.plugins.android.application)
}

abstract class SyncBoopsWebAssetsTask : DefaultTask() {
  @get:Inject
  abstract val fileSystemOperations: FileSystemOperations

  @get:InputDirectory
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val sourceWebDir: DirectoryProperty

  @get:OutputDirectory
  abstract val outputDir: DirectoryProperty

  @TaskAction
  fun syncAssets() {
    val src = sourceWebDir.get().asFile
    val dst = outputDir.get().asFile
    fileSystemOperations.sync {
      from(src) {
        exclude(".DS_Store", "**/.DS_Store")
        into("web")
      }
      into(dst)
    }
  }
}

val boopsWebDir = rootProject.layout.projectDirectory.dir("../web")

android {
  namespace = "space.boops.crewhealth"
  compileSdk = 36

  defaultConfig {
    applicationId = "space.boops.crewhealth"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "0.1.0"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    aidl = false
    buildConfig = true
    shaders = false
  }

  androidResources {
    noCompress += listOf("wasm", "task")
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

androidComponents {
  onVariants { variant ->
    val capName = variant.name.replaceFirstChar { it.uppercase() }
    val syncTask = tasks.register<SyncBoopsWebAssetsTask>("sync${capName}BoopsWebAssets") {
      sourceWebDir.set(boopsWebDir)
    }
    variant.sources.assets?.addGeneratedSourceDirectory(syncTask, SyncBoopsWebAssetsTask::outputDir)
  }
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.webkit)
  implementation(libs.androidx.health.connect)
  implementation(libs.kotlinx.coroutines.android)

  testImplementation(libs.junit)
  testImplementation(libs.org.json)
}
