# CirqtLab Kit

An app to monitor and collect sensor data from Omni Ring, with firmware upgrade capability.

## Demo

iOS: <https://youtu.be/q7RkwP5KWxk?si=XLoITGCucAORvAOD>

Android: <https://youtu.be/RUDWIhmi_AQ?si=TjyfcvOSTkZVFZVK>

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

## Run on iOS

1. Start the app

   ```bash
   npx expo start
   ```

2. Prebuild the app

    ```bash
    npx expo prebuild --clean
    ```

3. Open XCode

    When you're ready, navigate to `/ios`, open `CirqtLabKit.xcworkspace`, select a real iPhone (simulator won't work for bluetooth), then hit Play.

    Configure development team as necessary.

## Run on Android

- Use JDK 17 for build. Do no use JDK 21+.

1. Prebuild the app

    ```bash
    npx expo prebuild --clean
    ```

2. Run on real Android device

    Plug in a physical Android device onto your computer (that runs the expo app), and **Enable Debugging**.

    Then run `npx expo run:android`.
